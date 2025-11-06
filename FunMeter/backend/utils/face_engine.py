# === file: utils/face_engine.py ===
#!/usr/bin/env python3
"""
Drop-in face engine using YuNet (detector) + SFace (embedding + matching)
- Safe default backend: CPU (avoids CUDA assertion error)
- Simple Redis-based face DB (centroid per label)
- Optional NPZ save/load for offline DB

Requires: opencv-contrib-python>=4.7, numpy, redis (optional)
"""
from __future__ import annotations
import os, glob
from dataclasses import dataclass
from typing import Any, Optional, Set, Union, TYPE_CHECKING, cast, Dict, List, Tuple 
import numpy as np
import cv2 as cv

try:
    import redis
except Exception:
    redis = None

# -----------------------------
# Defaults / constants
# -----------------------------
ByteLike = Union[bytes, bytearray, memoryview]
MODELS_DIR = os.environ.get("MODELS_DIR", os.path.join(os.getcwd(), "models"))
YUNET_CANDIDATES = [
    "face_detection_yunet_2023mar.onnx",
    "face_detection_yunet_2022mar.onnx", 
    "face_detection_yunet_2021dec.onnx",
]
SFACE_FILENAME = "face_recognition_sface_2021dec.onnx"
EMOTION_CHOICE = "mobilefacenet"  # "mobilefacenet"  | "ferplus"
EMOTION_LABELS = ["neutral","happiness","surprise","sadness","anger","disgust","fear","contempt"]
COSINE_SIM_THRESH = float(os.environ.get("SFACE_COSINE_THRESH", 0.6))
L2_SIM_THRESH = float(os.environ.get("SFACE_L2_THRESH", 1.128))
BACKENDS: Dict[str, Tuple[int, int]] = {
    "cpu": (cv.dnn.DNN_BACKEND_OPENCV, cv.dnn.DNN_TARGET_CPU), 
    "cuda": (cv.dnn.DNN_BACKEND_CUDA, cv.dnn.DNN_TARGET_CUDA_FP16),
}
# -----------------------------
# Face DB (Redis or in-memory)
# -----------------------------
class RedisFaceDB:
    def __init__(self, url: Optional[str]):
        if url is None:
            url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        if redis is None:
            raise RuntimeError("redis package not installed. `pip install redis`")

        # Biarkan Pylance santai: treat sebagai Any atau anotasi ke Redis sinkron saat type-checking.
        if TYPE_CHECKING:
            from redis.client import Redis  # type: ignore
            self.r: "Redis"  # type: ignore[valid-type]
        else:
            # Optimize Redis connection with connection pooling
            self.r = redis.StrictRedis.from_url(
                url,
                max_connections=20,
                retry_on_timeout=True,
                socket_keepalive=True,
                socket_keepalive_options={},
                health_check_interval=30
            )

        self.key_index = "face:index"   # set of labels
        self.key_vec = "face:vec:{}"    # per-label vector bytes

    def save_vector(self, label: str, vec: np.ndarray) -> None:
        v = np.asarray(vec, dtype=np.float32).reshape(-1)
        # StrictRedis default: decode_responses=False -> bytes aman untuk biner
        self.r.sadd(self.key_index, label)
        self.r.set(self.key_vec.format(label), v.tobytes())

    def load_all(self) -> Dict[str, np.ndarray]:
        # Pylance terkadang melihat ini sebagai Awaitable[Set[Unknown]] → cast ke set of bytes/str.
        labels_raw = cast(Set[Union[bytes, str]], self.r.smembers(self.key_index))

        # Normalisasi label -> str
        labels: List[str] = [
            lab.decode() if isinstance(lab, (bytes, bytearray)) else str(lab)
            for lab in labels_raw
        ]

        out: Dict[str, np.ndarray] = {}
        for lab in labels:
            raw = cast(Optional[bytes], self.r.get(self.key_vec.format(lab)))
            if not raw:  # None atau b''
                continue

            # bytes sudah memenuhi BufferProtocol, memoryview tidak wajib
            arr = np.frombuffer(raw, dtype=np.float32)
            out[lab] = np.asarray(arr, dtype=np.float32).reshape(-1)
        return out

    def delete_label(self, label: str) -> None:
        self.r.delete(self.key_vec.format(label))
        self.r.srem(self.key_index, label)

# -----------------------------
# Helpers
# -----------------------------
def _find_model(path_or_name: str) -> str:
    if os.path.isabs(path_or_name) and os.path.exists(path_or_name):
        return path_or_name
    return os.path.join(MODELS_DIR, path_or_name)

def _emotion_paths():
    return {
        "ferplus": _find_model("emotion-ferplus-8.onnx"),
        "mobilefacenet": _find_model("facial_expression_recognition_mobilefacenet_2022july.onnx"),
    }

def _resolve_yunet() -> str:
    for name in YUNET_CANDIDATES:
        p = _find_model(name)
        if os.path.exists(p):
            return p
    # fallback: kembalikan kandidat pertama (walau belum tentu ada)
    return _find_model(YUNET_CANDIDATES[0])

@dataclass
class FaceModels:
    detector: Any  # cv.FaceDetectorYN (type stub)
    recognizer: Any  # cv.FaceRecognizerSF (type stub)

class EmotionFERPlus:
    """
    ONNX FER+ (8 classes). Input expect: [1,1,64,64] float32 in [0..1].
    Output: logits atau probs size=8.
    """
    def __init__(self, path: str, backend_id: int, target_id: int):
        if not os.path.exists(path):
            raise FileNotFoundError(f"Emotion model not found: {path}")
        self.net = cv.dnn.readNet(path)
        self.net.setPreferableBackend(backend_id)
        self.net.setPreferableTarget(target_id)

    @staticmethod
    def _softmax(x: np.ndarray) -> np.ndarray:
        x = x.astype(np.float32).reshape(-1)
        x = x - np.max(x)
        ex = np.exp(x)
        return ex / np.sum(ex)

    def _preprocess(self, aligned_bgr):
        g = cv.cvtColor(aligned_bgr, cv.COLOR_BGR2GRAY)
        g = cv.resize(g, (64, 64), interpolation=cv.INTER_AREA)
        clahe = cv.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        g = clahe.apply(g)
        g = g.astype(np.float32) * 1   # tetap 0..255 (atau sesuai env)
        return g[None, None, :, :]


    def predict_probs(self, aligned_bgr: np.ndarray) -> np.ndarray:
        blob = self._preprocess(aligned_bgr)
        self.net.setInput(blob)
        out = self.net.forward()  # shape (1,8) atau (1,1,1,8)
        out = out.reshape(-1).astype(np.float32)
        probs = self._softmax(out)  # aman walau input sudah prob
        return probs

class EmotionMobileFaceNet:
    """
    MobileFaceNet for facial expression recognition (OpenCV Zoo).
    Input: BGR face aligned (112x112).
    Output: probs vector (umumnya 7 classes).
    """
    def __init__(self, path: str, backend_id: int, target_id: int):
        if not os.path.exists(path):
            raise FileNotFoundError(f"Emotion model not found: {path}")
        self.net = cv.dnn.readNet(path)
        self.net.setPreferableBackend(backend_id)
        self.net.setPreferableTarget(target_id)

    def _preprocess(self, aligned_bgr: np.ndarray) -> np.ndarray:
        img = cv.resize(aligned_bgr, (112, 112))
        rgb = cv.cvtColor(img, cv.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - 0.5) / 0.5  # [-1, 1]
        blob = rgb.transpose(2, 0, 1)[np.newaxis, ...]  # [1,3,112,112]
        return blob

    def predict_probs(self, aligned_bgr: np.ndarray) -> np.ndarray:
        blob = self._preprocess(aligned_bgr)
        self.net.setInput(blob)
        out = self.net.forward().reshape(-1).astype(np.float32)
        exps = np.exp(out - np.max(out)) 
        probs = exps / np.sum(exps)
        return probs

# -----------------------------
# Face Engine
# -----------------------------
class FaceEngine:
    def __init__(
        self,
        models_dir: str = MODELS_DIR,
        backend: str = "cuda",
        score_threshold: float = 0.75,
        nms_threshold: float = 0.3,
        top_k: int = 5000,
        input_size: Tuple[int, int] = (320, 320),
        use_redis: bool = True,
        redis_url: Optional[str] = None,
    ):
        self.models_dir = models_dir

        backend = backend.lower().strip()
        if backend not in BACKENDS:
            raise ValueError(f"Unknown backend {backend}")
        self.backend_id, self.target_id = BACKENDS[backend]

        if backend == "cuda":
            try:
                has_dnn_cuda = hasattr(cv.dnn, "DNN_BACKEND_CUDA")
                devs = cv.cuda.getCudaEnabledDeviceCount() if hasattr(cv, "cuda") else 0

                # Anggap READY jika device>0 dan backend DNN CUDA ada
                if not (has_dnn_cuda and devs > 0):
                    raise RuntimeError(f"CUDA not ready (DNN_CUDA:{has_dnn_cuda}, devices:{devs})")

                try:
                    info = cv.getBuildInformation()
                    ok_cudnn = any("cuDNN:" in line and "YES" in line for line in info.splitlines())
                    if (ok_cudnn == False):
                        print("[WARN] cuDNN not in build; DNN CUDA jalan tanpa cuDNN (lebih lambat).")
                except Exception:
                    pass  # kalau getBuildInformation() gagal, abaikan
                 
            except Exception as e:
                print(f"[WARN] CUDA unavailable ({e}). Falling back to CPU.")
                self.backend_id, self.target_id = BACKENDS["cpu"]

        yunet_path = _resolve_yunet()
        sface_path = _find_model(SFACE_FILENAME)
        if not os.path.exists(yunet_path):
            raise FileNotFoundError(f"YuNet not found: {yunet_path}")
        if not os.path.exists(sface_path):
            raise FileNotFoundError(f"SFace not found: {sface_path}")

        self.detector = cv.FaceDetectorYN.create(
            yunet_path, "", input_size, float(score_threshold),
            float(nms_threshold), int(top_k),
            self.backend_id, self.target_id
        )
        self.recognizer = cv.FaceRecognizerSF.create(
            sface_path, "", self.backend_id, self.target_id
        )

        # Emotion model (opsional; logic: pakai MobileFaceNet jika file ada)
        # Emotion model (opsional; manual selector)
        self.emotion: Optional[EmotionMobileFaceNet | EmotionFERPlus] = None
        self.emotion_labels: List[str] = EMOTION_LABELS[:]  # default FER+ (8 kelas)
        try:
            choice = (EMOTION_CHOICE or "auto").lower().strip()
            paths = _emotion_paths()

            if choice == "ferplus":
                p = paths["ferplus"]
                self.emotion = EmotionFERPlus(p, self.backend_id, self.target_id)
                self.emotion_labels = EMOTION_LABELS[:]  # ["neutral","happiness","surprise","sadness","anger","disgust","fear","contempt"]

            elif choice == "mobilefacenet":
                p = paths["mobilefacenet"]
                self.emotion = EmotionMobileFaceNet(p, self.backend_id, self.target_id)
                # urutan sesuai OpenCV Zoo (7 kelas)
                self.emotion_labels = ["angry", "disgust", "fearful", "happy", "neutral", "sad", "surprised"]

            elif choice == "auto":
                # prefer MobileFaceNet jika ada; fallback ke FER+
                if os.path.exists(paths["mobilefacenet"]):
                    self.emotion = EmotionMobileFaceNet(paths["mobilefacenet"], self.backend_id, self.target_id)
                    self.emotion_labels = ["angry", "disgust", "fearful", "happy", "neutral", "sad", "surprised"]
                elif os.path.exists(paths["ferplus"]):
                    self.emotion = EmotionFERPlus(paths["ferplus"], self.backend_id, self.target_id)
                    self.emotion_labels = EMOTION_LABELS[:]

            elif choice == "none":
                # tetap None → fitur fun meter nonaktif
                pass

        except FileNotFoundError as _e:
            # model tidak ditemukan; biarkan None (UI/route sudah handle)
            print(f"[WARN] Emotion model not found: {_e}")
        except Exception as _e:
            print(f"[WARN] Emotion init failed: {_e}")
            self.emotion = None

        # Face DB
        self.db: Dict[str, np.ndarray] = {}
        self.redis_db: Optional[RedisFaceDB] = None
        if use_redis:
            try:
                # BUGFIX: jangan cast None -> 'None'
                self.redis_db = RedisFaceDB(redis_url)
                self.db = self.redis_db.load_all()
            except Exception:
                # Fall back silently ke in-memory jika Redis tidak tersedia
                self.redis_db = None

    # ------------- core ops -------------
    def set_detector_params(self, score: Optional[float]=None, nms: Optional[float]=None, top_k: Optional[int]=None):
        if score is not None:
            self.detector.setScoreThreshold(float(score))
        if nms is not None:
            self.detector.setNMSThreshold(float(nms))
        if top_k is not None:
            self.detector.setTopK(int(top_k))

    def get_embedding(self, bgr: np.ndarray, face_row: np.ndarray) -> np.ndarray:
        """
        Back-compat shim untuk kode lama yang masih manggil get_embedding().
        Sama persis dengan align_and_embed().
        """
        return self.align_and_embed(bgr, face_row)
    
    def detect(self, bgr: np.ndarray) -> Optional[np.ndarray]:
        # Upscale kalau gambar kecil biar YuNet lebih “ngeh”
        h, w = bgr.shape[:2]
        min_side = min(h, w)

        if min_side < 480:
            scale = 480.0 / float(min_side)
            new_w = int(round(w * scale))
            new_h = int(round(h * scale))
            up = cv.resize(bgr, (new_w, new_h), interpolation=cv.INTER_CUBIC)
            self.detector.setInputSize((new_w, new_h))
            res = self.detector.detect(up)
        else:
            scale = 1.0
            self.detector.setInputSize((w, h))
            res = self.detector.detect(bgr)

        faces = res[1] if isinstance(res, tuple) else res
        if faces is None or len(faces) == 0:
            return faces

        # YuNet output: [x, y, w, h, (5 landmark x,y = 10 angka), score]
        # Kembalikan koordinat ke skala asli (jangan sentuh score di index ke-14)
        if scale != 1.0:
            faces = faces.copy()
            faces[:, :14] /= scale

        return faces

    def align_and_embed(self, bgr: np.ndarray, face_row: np.ndarray) -> np.ndarray:
        aligned = self.recognizer.alignCrop(bgr, face_row)
        feat = self.recognizer.feature(aligned)
        feat = np.asarray(feat, dtype=np.float32).reshape(-1)
        # Normalize ke unit vector (stabil untuk cosine)
        n = float(np.linalg.norm(feat))
        if n > 0:
            feat = feat / n
        return feat

    def register_from_image(self, label: str, bgr: np.ndarray) -> Tuple[bool, str]:
        faces = self.detect(bgr)
        if faces is None or len(faces) == 0:
            return False, "No face detected"
        idx = int(np.argmax(faces[:, 14]))  # score tertinggi
        feat = self.align_and_embed(bgr, faces[idx])
        # Save
        self.db[label] = feat
        if self.redis_db:
            self.redis_db.save_vector(label, feat)
        return True, "OK"

    def register_embedding(self, label: str, emb: "np.ndarray | list[float]") -> "tuple[bool, str]":
        """
        Daftarkan embedding langsung (tanpa gambar). Auto-normalize ke unit vector.
        """
        try:
            vec = np.asarray(emb, dtype=np.float32).reshape(-1)
            n = float(np.linalg.norm(vec))
            if n == 0:
                return False, "Empty embedding"
            vec /= n  # unit vector (konsisten dengan align_and_embed)
            self.db[label] = vec
            if self.redis_db:
                self.redis_db.save_vector(label, vec)
            return True, "OK"
        except Exception as e:
            return False, f"Exception: {e}"

    def build_from_dataset(self, dataset_dir: str, max_per_label: Optional[int] = None) -> None:
        labels = [d for d in os.listdir(dataset_dir) if os.path.isdir(os.path.join(dataset_dir, d))]
        for lab in labels:
            paths: List[str] = []
            for ext in ("*.jpg", "*.jpeg", "*.png", "*.bmp", "*.webp"):
                paths.extend(glob.glob(os.path.join(dataset_dir, lab, ext)))
            if not paths:
                continue
            if max_per_label:
                paths = paths[:max_per_label]

            feats: List[np.ndarray] = []
            for p in paths:
                img = cv.imread(p)
                if img is None:
                    continue
                faces = self.detect(img)
                if faces is None or len(faces) == 0:
                    continue
                i = int(np.argmax(faces[:, 14]))
                f = self.align_and_embed(img, faces[i])
                feats.append(f)

            if feats:
                centroid = np.mean(np.vstack(feats), axis=0).astype(np.float32)
                n = np.linalg.norm(centroid)
                if n > 0:
                    centroid = centroid / n
                self.db[lab] = centroid
                if self.redis_db:
                    self.redis_db.save_vector(lab, centroid)

    def match(self, feat: np.ndarray, method: str = "cosine") -> Tuple[str, float]:
        if not self.db:
            return "Unknown", 0.0

        labels = list(self.db.keys())
        feats = np.vstack([np.asarray(self.db[l], dtype=np.float32).reshape(-1) for l in labels])
        if feats.ndim > 2:
            feats = feats.reshape(feats.shape[0], -1)

        feat = np.asarray(feat, dtype=np.float32).reshape(-1)

        if method == "cosine":
            sims = feats @ feat  # cosine (semua vektor sudah dinormalisasi)
            best_idx = int(np.argmax(sims))
            best_score = float(sims[best_idx])
            return labels[best_idx], best_score

        # L2: jarak lebih kecil lebih baik → ubah ke pseudo-similarity
        dists = np.linalg.norm(feats - feat[None, :], axis=1)
        best_idx = int(np.argmin(dists))
        best_dist = float(dists[best_idx])
        return labels[best_idx], 1.0 / (1.0 + best_dist)

    def recognize(self, bgr: np.ndarray, cosine_thresh: float = COSINE_SIM_THRESH):
        faces = self.detect(bgr)
        results = []
        if faces is None or len(faces) == 0:
            return results

        for i in range(faces.shape[0]):
            feat = self.align_and_embed(bgr, faces[i])
            label, score = self.match(feat, method="cosine")
            if score < cosine_thresh:
                label = "Unknown"
            results.append((faces[i], label, float(score)))
        return results
 
    def _emo_index(self, name: str) -> int:
        """
        Cari index label emosi di self.emotion_labels, tahan beda penamaan:
        - happy/happiness, angry/anger, fearful/fear, surprised/surprise, sad/sadness
        """
        groups = {
            "happy": {"happy", "happiness"},
            "angry": {"angry", "anger"},
            "disgust": {"disgust"},
            "fearful": {"fearful", "fear"},
            "sad": {"sad", "sadness"},
            "surprised": {"surprised", "surprise"},
            "neutral": {"neutral"},
            "contempt": {"contempt"},
        }
        key = name.lower()
        reverse = {v: k for k, vs in groups.items() for v in vs}
        key = reverse.get(key, key)
        candidates = groups.get(key, {key})
        for i, lab in enumerate(self.emotion_labels):
            if lab.lower() in candidates:
                return i
        return 0  # fallback aman

    def analyze_emotions(self, bgr: np.ndarray):
        results = []
        if self.emotion is None:
            return results

        faces = self.detect(bgr)
        if faces is None or len(faces) == 0:
            return results

        for i in range(faces.shape[0]):
            aligned = self.recognizer.alignCrop(bgr, faces[i])
            probs = self.emotion.predict_probs(aligned)  # 7 (MobileFaceNet) atau 8 (FER+)
            probs = probs.astype(np.float32)

            top_idx = int(np.argmax(probs))
            top_label = self.emotion_labels[top_idx]
            top_prob = float(probs[top_idx])

            # happy/happiness index
            idx_happy = self._emo_index("happy")
            fun_raw = float(probs[idx_happy])  # 0..1

            # penalti emosional negatif
            neg_ids = [self._emo_index(x) for x in ("angry", "disgust", "fearful", "sad")]
            neg_sum = float(np.sum(probs[neg_ids]))  # 0..1 (kira-kira)

            # koefisien 0.30 sesuai kode asal (bisa di-tune via env di luar file ini)
            fun_adj = max(0.0, fun_raw - 0.30 * neg_sum)

            # smoothing simple (EMA)
            if not hasattr(self, "_fun_ema"):
                self._fun_ema = fun_adj
            else:
                self._fun_ema = 0.7 * self._fun_ema + 0.3 * fun_adj

            fun_score = float(self._fun_ema)

            results.append((faces[i], probs, top_label, top_prob, fun_score))
        return results

    def save_npz(self, path: str) -> None:
        if not self.db:
            raise RuntimeError("DB is empty")
        labels = list(self.db.keys())
        feats = np.stack([self.db[k] for k in labels], axis=0)
        np.savez_compressed(path, labels=np.array(labels), features=feats)

    def load_npz(self, path: str) -> None:
        data = np.load(path, allow_pickle=True)
        labels = data["labels"].tolist()
        feats = data["features"]
        self.db = {lab: np.asarray(feats[i], dtype=np.float32).reshape(-1) for i, lab in enumerate(labels)}
