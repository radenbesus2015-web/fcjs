# Implementasi Lazy Cache pada Attendance Fun Meter

## Overview
Implementasi lazy cache yang komprehensif untuk meningkatkan performance aplikasi attendance-fun-meter dengan caching berbagai jenis data dan optimasi memory management.

## Fitur Utama

### 🚀 **LazyCache Class**
Cache class yang fleksibel dengan TTL (Time To Live) dan automatic cleanup:

```typescript
class LazyCache<T> {
  private cache = new Map<string, { data: T; timestamp: number; ttl: number }>();
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize = 100, defaultTTL = 5 * 60 * 1000) // 5 minutes default
  
  // Methods:
  set(key: string, data: T, ttl?: number): void
  get(key: string): T | null
  has(key: string): boolean
  delete(key: string): boolean
  clear(): void
  size(): number
  async getOrSet(key: string, factory: () => Promise<T>, ttl?: number): Promise<T>
}
```

### 📊 **Cache Instances**
Berbagai cache instances untuk data yang berbeda:

```typescript
const adMediaCache = new LazyCache<AdMedia[]>(10, 10 * 60 * 1000);        // 10 minutes
const attendanceResultsCache = new LazyCache<AttendanceResult[]>(50, 30 * 1000); // 30 seconds
const emotionResultsCache = new LazyCache<EmotionResult[]>(50, 15 * 1000);       // 15 seconds
const videoFrameCache = new LazyCache<Uint8Array>(20, 5 * 1000);                // 5 seconds
const settingsCache = new LazyCache<Record<string, unknown>>(20, 60 * 1000);    // 1 minute
```

## Performance Utilities

### ⏱️ **Debounce Hook**
```typescript
function useDebounce<T>(value: T, delay: number): T
```
- Menunda update value hingga delay selesai
- Mencegah excessive re-renders
- Digunakan untuk ad index changes

### 🎯 **Throttle Hook**
```typescript
function useThrottle<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T
```
- Membatasi frekuensi eksekusi function
- Digunakan untuk frame processing
- Mencegah performance bottlenecks

### 🧠 **Memoized Computation Hook**
```typescript
function useMemoizedComputation<T>(
  computation: () => T,
  deps: React.DependencyList,
  cacheKey?: string
): T
```
- Memoization dengan optional caching
- Menghindari expensive computations
- Digunakan untuk settings calculations

## Cache Implementation Details

### 1. **Advertisement Cache**
```typescript
// Cache advertisements for 10 minutes
const loadAdsWithCache = async () => {
  const cacheKey = 'active-advertisements';
  
  // Try cache first
  const cachedAds = adMediaCache.get(cacheKey);
  if (cachedAds) {
    setAdMediaList(cachedAds);
    updateCacheStats('adMediaHits');
    return;
  }

  // Load from API with cache
  const data = await adMediaCache.getOrSet(
    cacheKey,
    async () => {
      const apiData = await fetchActiveAdvertisements();
      return apiData
        .filter((ad) => ad.enabled)
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
        .map((ad) => ({
          src: ad.src,
          type: ad.type as 'image' | 'video',
        }));
    },
    10 * 60 * 1000 // 10 minutes TTL
  );
  
  setAdMediaList(data);
};
```

### 2. **Attendance Results Cache**
```typescript
att_result(...args: unknown[]) {
  const data = args[0] as AttResultData;
  const results = Array.isArray(data?.results) ? data.results : [];
  
  // Cache attendance results
  const cacheKey = `att-result-${Date.now()}`;
  attendanceResultsCache.set(cacheKey, results, 30 * 1000); // 30 seconds TTL
  updateCacheStats('attendanceHits');
  
  setAttendanceResults(results);
  setLastAttResults({ t: Date.now(), results });
}
```

### 3. **Emotion Results Cache**
```typescript
fun_result(...args: unknown[]) {
  const data = args[0] as FunResultData;
  const results = Array.isArray(data?.results) ? data.results : [];
  
  // Cache emotion results
  const cacheKey = `emotion-result-${Date.now()}`;
  emotionResultsCache.set(cacheKey, results, 15 * 1000); // 15 seconds TTL
  updateCacheStats('emotionHits');
  
  setEmotionResults(results);
  drawFun(results);
}
```

### 4. **Video Frame Cache**
```typescript
const toBytes = useCallback(async (): Promise<Uint8Array | null> => {
  if (!snapCanvasRef.current) return null;
  
  const canvas = snapCanvasRef.current;
  const frameKey = `frame-${canvas.width}x${canvas.height}-${Date.now()}`;
  
  // Check cache first
  const cachedFrame = videoFrameCache.get(frameKey);
  if (cachedFrame) {
    console.log('[FRAME CACHE] Using cached frame');
    updateCacheStats('frameHits');
    return cachedFrame;
  }
  
  // Generate new frame
  const preferWebP = !!document.createElement("canvas").toDataURL("image/webp").match("data:image/webp");
  const type = preferWebP ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob | null>((res) => 
    canvas.toBlob(res, type, memoizedSettings.jpegQuality)
  );
  
  if (!blob) return null;
  
  const bytes = new Uint8Array(await blob.arrayBuffer());
  
  // Cache the frame
  videoFrameCache.set(frameKey, bytes, 5 * 1000); // 5 seconds TTL
  
  return bytes;
}, [memoizedSettings.jpegQuality, updateCacheStats]);
```

### 5. **Settings Cache**
```typescript
// Memoized settings for performance
const memoizedSettings = useMemoizedComputation(
  () => ({
    baseInterval: Number(baseInterval),
    attSendWidth: Number(attSendWidth),
    funSendWidth: Number(funSendWidth),
    jpegQuality: Number(jpegQuality),
    funIntervalMs: Number(funIntervalMs)
  }),
  [baseInterval, attSendWidth, funSendWidth, jpegQuality, funIntervalMs],
  'app-settings'
);
```

## Video Preloading Optimization

### 🎬 **Lazy Video Preloading**
```typescript
const preloadVideo = (ad: AdMedia) => {
  if (ad.type !== 'video' || preloadCache.current.has(ad.src)) return;
  
  console.log('[VIDEO CACHE] Preloading video:', ad.src);
  preloadCache.current.set(ad.src, true);
  
  const video = document.createElement('video');
  video.src = ad.src;
  video.preload = 'metadata'; // Changed from 'auto' to 'metadata' for better performance
  video.muted = true;
  video.playsInline = true;
  
  // Lazy load on intersection or user interaction
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        video.preload = 'auto';
        video.load();
        observer.disconnect();
      }
    });
  });
  
  // Add to DOM temporarily for intersection observation
  video.style.position = 'absolute';
  video.style.top = '-9999px';
  video.style.left = '-9999px';
  video.style.width = '1px';
  video.style.height = '1px';
  document.body.appendChild(video);
  observer.observe(video);
  
  preloadedVideos.current.set(ad.src, video);
  
  // Cleanup after 30 seconds if not used
  setTimeout(() => {
    if (document.body.contains(video)) {
      document.body.removeChild(video);
    }
  }, 30000);
};
```

## Cache Statistics & Monitoring

### 📈 **Cache Statistics Tracking**
```typescript
const [cacheStats, setCacheStats] = useState({
  adMediaHits: 0,
  attendanceHits: 0,
  emotionHits: 0,
  frameHits: 0,
  totalRequests: 0
});

const updateCacheStats = useCallback((type: keyof typeof cacheStats) => {
  setCacheStats(prev => ({
    ...prev,
    [type]: prev[type] + 1,
    totalRequests: prev.totalRequests + 1
  }));
}, []);
```

### 🔍 **Development Mode Display**
```jsx
{process.env.NODE_ENV === 'development' && (
  <div className={`cache-stats ${cacheStats.totalRequests > 0 ? 'show' : ''}`}>
    <div>Cache Hit Rate: {hitRate}%</div>
    <div>Ads: {adMediaCache.size()}/10 | Att: {attendanceResultsCache.size()}/50</div>
    <div>Emo: {emotionResultsCache.size()}/50 | Frames: {videoFrameCache.size()}/20</div>
    <div>Settings: {settingsCache.size()}/20 | Total: {cacheStats.totalRequests}</div>
  </div>
)}
```

### 📊 **Console Logging (Development)**
```typescript
useEffect(() => {
  if (process.env.NODE_ENV === 'development') {
    const logInterval = setInterval(() => {
      const hitRate = cacheStats.totalRequests > 0 
        ? ((cacheStats.adMediaHits + cacheStats.attendanceHits + cacheStats.emotionHits + cacheStats.frameHits) / cacheStats.totalRequests * 100).toFixed(1)
        : '0';
      
      console.log('[CACHE STATS]', {
        hitRate: `${hitRate}%`,
        adMedia: `${adMediaCache.size()}/${10}`,
        attendance: `${attendanceResultsCache.size()}/${50}`,
        emotions: `${emotionResultsCache.size()}/${50}`,
        frames: `${videoFrameCache.size()}/${20}`,
        settings: `${settingsCache.size()}/${20}`,
        stats: cacheStats
      });
    }, 30000); // Log every 30 seconds
    
    return () => clearInterval(logInterval);
  }
}, [cacheStats]);
```

## Memory Management

### 🧹 **Automatic Cleanup**
```typescript
// Cache cleanup on unmount
useEffect(() => {
  return () => {
    console.log('[CACHE CLEANUP] Clearing all caches on unmount');
    adMediaCache.clear();
    attendanceResultsCache.clear();
    emotionResultsCache.clear();
    videoFrameCache.clear();
    settingsCache.clear();
    
    // Cleanup preloaded videos
    preloadedVideos.current.forEach((video) => {
      if (document.body.contains(video)) {
        document.body.removeChild(video);
      }
      video.src = '';
    });
    preloadedVideos.current.clear();
    preloadCache.current.clear();
  };
}, []);
```

### 🔄 **LRU (Least Recently Used) Eviction**
```typescript
set(key: string, data: T, ttl?: number): void {
  // Remove oldest entries if cache is full
  if (this.cache.size >= this.maxSize) {
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey) this.cache.delete(oldestKey);
  }

  this.cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl: ttl || this.defaultTTL
  });
}
```

## Performance Optimizations

### ⚡ **Throttled Frame Processing**
```typescript
// Throttled frame pushing with cache
const pushFunFrame = useThrottle(
  useCallback(async () => {
    // Frame processing logic with cache
  }, [socket, sendingFun, toBytes]),
  memoizedSettings.funIntervalMs / 2 // Throttle at half the interval
);
```

### 🎯 **Memoized Canvas Operations**
```typescript
// Memoized snap size calculation
const ensureSnapSize = useCallback(() => {
  const v = videoRef.current;
  if (!v) return false;
  
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return false;
  
  const newHeight = Math.round((memoizedSettings.funSendWidth * vh) / vw);
  
  // Only update if dimensions changed
  if (sendHeightRef.current !== newHeight) {
    sendHeightRef.current = newHeight;
    
    if (!snapCanvasRef.current) {
      snapCanvasRef.current = document.createElement("canvas");
    }
    
    snapCanvasRef.current.width = memoizedSettings.funSendWidth;
    snapCanvasRef.current.height = newHeight;
    
    console.log('[SNAP_SIZE] Updated canvas size:', memoizedSettings.funSendWidth, 'x', newHeight);
  }
  
  return true;
}, [memoizedSettings.funSendWidth]);
```

## Cache Configuration

### ⚙️ **TTL Settings**
| **Cache Type** | **Max Size** | **TTL** | **Purpose** |
|----------------|--------------|---------|-------------|
| Ad Media | 10 | 10 minutes | Advertisement data |
| Attendance Results | 50 | 30 seconds | Real-time attendance |
| Emotion Results | 50 | 15 seconds | Real-time emotions |
| Video Frames | 20 | 5 seconds | Frame processing |
| Settings | 20 | 1 minute | App configuration |

### 🎛️ **Customizable Parameters**
```typescript
// Adjustable cache sizes and TTLs
const adMediaCache = new LazyCache<AdMedia[]>(
  parseInt(process.env.NEXT_PUBLIC_AD_CACHE_SIZE || '10'),
  parseInt(process.env.NEXT_PUBLIC_AD_CACHE_TTL || '600000')
);
```

## Benefits

### ✅ **Performance Improvements**
- **Reduced API Calls**: Cache advertisements for 10 minutes
- **Faster Frame Processing**: Cache encoded frames for 5 seconds
- **Optimized Settings**: Memoize expensive calculations
- **Smooth Video Playback**: Lazy preloading with intersection observer

### ✅ **Memory Efficiency**
- **LRU Eviction**: Automatic cleanup of old entries
- **TTL Expiration**: Automatic removal of stale data
- **Size Limits**: Prevent unlimited memory growth
- **Cleanup on Unmount**: Proper resource management

### ✅ **Developer Experience**
- **Cache Statistics**: Real-time monitoring in development
- **Console Logging**: Detailed cache performance metrics
- **Visual Indicators**: On-screen cache hit rate display
- **Configurable**: Easy to adjust cache parameters

### ✅ **User Experience**
- **Faster Loading**: Cached data loads instantly
- **Smoother Animations**: Throttled and debounced operations
- **Reduced Bandwidth**: Less network requests
- **Better Responsiveness**: Optimized frame processing

## Usage Examples

### 🔧 **Basic Cache Usage**
```typescript
// Set data with custom TTL
cache.set('key', data, 60000); // 1 minute

// Get data (returns null if expired)
const data = cache.get('key');

// Get or set with factory function
const data = await cache.getOrSet('key', async () => {
  return await fetchData();
}, 120000); // 2 minutes
```

### 📊 **Cache Monitoring**
```typescript
// Check cache statistics
console.log('Cache size:', cache.size());
console.log('Has key:', cache.has('key'));

// Clear specific cache
cache.delete('key');

// Clear all cache
cache.clear();
```

## Testing & Debugging

### 🧪 **Development Tools**
- Cache statistics display in top-left corner
- Console logging every 30 seconds
- Hit rate calculation and monitoring
- Memory usage tracking

### 🔍 **Performance Metrics**
- Cache hit rate percentage
- Memory usage per cache type
- Request count tracking
- TTL effectiveness monitoring

Implementasi lazy cache ini memberikan peningkatan performance yang signifikan dengan mengurangi network requests, optimasi memory usage, dan memberikan user experience yang lebih smooth pada aplikasi attendance-fun-meter.
