# Optimasi Loading Video Ads

## Masalah yang Diatasi
Video iklan membutuhkan waktu loading yang lama, menyebabkan user experience yang buruk dan delay dalam rotasi iklan.

## Solusi yang Diimplementasikan

### 🚀 **Aggressive Preloading Strategy**

#### **1. Priority-Based Preloading**
```typescript
// High Priority: Current video (immediate loading)
if (priority === 'high') {
  video.preload = 'auto';
  video.load(); // Force immediate loading
}

// Medium Priority: Next video (delayed loading)
if (priority === 'medium') {
  video.preload = 'metadata';
  setTimeout(() => {
    video.preload = 'auto';
    video.load();
  }, 1000);
}

// Low Priority: Other videos (on-demand loading)
if (priority === 'low') {
  video.preload = 'none';
}
```

#### **2. Immediate First Video Preload**
```typescript
// Preload first video immediately when ads are loaded
const firstVideo = processedAds.find(ad => ad.type === 'video');
if (firstVideo) {
  setTimeout(() => {
    const video = document.createElement('video');
    video.src = firstVideo.src;
    video.preload = 'auto';
    video.load();
    
    preloadedVideos.current.set(firstVideo.src, video);
  }, 50); // Start after 50ms
}
```

#### **3. Staggered Background Loading**
```typescript
// Preload all videos with staggered timing
adMediaList.forEach((ad, index) => {
  if (ad.type === 'video') {
    setTimeout(() => preloadVideo(ad, 'low'), 5000 + (index * 2000));
  }
});
```

### 📊 **Enhanced Video Management**

#### **1. Ready State Monitoring**
```typescript
const checkReady = () => {
  if (video.readyState >= 3) { // HAVE_FUTURE_DATA
    console.log('[VIDEO CACHE] High priority video ready:', ad.src);
    resolve();
  } else {
    setTimeout(checkReady, 100);
  }
};
```

#### **2. Progress Tracking**
```typescript
video.addEventListener('progress', () => {
  if (video.buffered.length > 0) {
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    const duration = video.duration || 0;
    if (duration > 0) {
      const bufferedPercent = (bufferedEnd / duration) * 100;
      console.log(`[VIDEO CACHE] Buffered ${bufferedPercent.toFixed(1)}% of ${ad.src}`);
    }
  }
});
```

#### **3. Error Handling & Fallback**
```typescript
video.addEventListener('error', (e) => {
  console.error('[VIDEO CACHE] Video load error:', ad.src, e);
  preloadCache.current.delete(ad.src);
  preloadedVideos.current.delete(ad.src);
});
```

### 🎬 **Smart Video Playback**

#### **1. Preloaded Video Usage**
```typescript
// Use preloaded video if available and ready
if (preloadedVideo && preloadedVideo.readyState >= 3) {
  console.log('[AD VIDEO] Using preloaded video:', currentAd.src);
  centerVideo.src = preloadedVideo.src;
  centerVideo.currentTime = 0;
  centerVideo.play(); // Immediate play
} else {
  // Fallback to normal loading
  centerVideo.src = currentAd.src;
  centerVideo.load();
}
```

#### **2. Wait for Ready State**
```typescript
const playWhenReady = () => {
  if (centerVideo.readyState >= 3) {
    centerVideo.play().catch(() => {
      setTimeout(() => centerVideo.play().catch(() => {}), 100);
    });
  } else {
    setTimeout(playWhenReady, 100);
  }
};
```

#### **3. Seamless Transition**
```typescript
const goToNextAd = useCallback(() => {
  const nextAd = adMediaList[nextIndex];
  
  // Ensure next video is ready before switching
  if (nextAd && nextAd.type === 'video') {
    const preloadedVideo = preloadedVideos.current.get(nextAd.src);
    if (preloadedVideo && preloadedVideo.readyState < 3) {
      // Wait for video to be ready
      preloadedVideo.load();
      setTimeout(() => setCurrentAdIndex(nextIndex), 500);
      return;
    }
  }
  
  setCurrentAdIndex(nextIndex);
}, [currentAdIndex, adMediaList]);
```

### 🎯 **Browser Optimization**

#### **1. Preload Hints**
```jsx
{/* HTML preload hints untuk browser */}
{adMediaList.map((ad, index) => (
  ad.type === 'video' && index < 5 ? (
    <link key={ad.src} rel="preload" as="video" href={ad.src} />
  ) : null
))}
```

#### **2. Video Element Optimization**
```jsx
<video
  preload="auto"
  crossOrigin="anonymous"
  loading="eager"
  onLoadStart={() => showLoading()}
  onCanPlay={() => hideLoading()}
  onWaiting={() => showLoading()}
  onPlaying={() => hideLoading()}
/>
```

#### **3. CSS Performance Hints**
```css
.ad-overlay-container video {
  will-change: transform, opacity;
  transform: translateZ(0);
  backface-visibility: hidden;
  image-rendering: -webkit-optimize-contrast;
  loading: eager;
}
```

### 📱 **Loading Indicator**

#### **1. Visual Feedback**
```jsx
{/* Loading indicator untuk video ads */}
{adMediaList[currentAdIndex]?.type === 'video' && (
  <div className="video-loading" id="video-loading">
    Loading video...
  </div>
)}
```

#### **2. Smart Show/Hide Logic**
```typescript
onLoadStart={() => showLoading()}
onLoadedData={() => hideLoading()}
onCanPlay={() => hideLoading()}
onWaiting={() => showLoading()}
onPlaying={() => hideLoading()}
onError={() => {
  hideLoading();
  setTimeout(goToNextAd, 1000); // Auto-skip on error
}}
```

### 🧹 **Memory Management**

#### **1. Extended Cache Time**
```typescript
// Extended cleanup time for better caching
setTimeout(() => {
  if (preloadedVideos.current.has(ad.src) && !document.body.contains(video)) {
    video.src = '';
    preloadedVideos.current.delete(ad.src);
    preloadCache.current.delete(ad.src);
  }
}, 120000); // 2 minutes instead of 30 seconds
```

#### **2. Smart Cleanup Strategy**
```typescript
// Don't immediately remove, let timeout handle it for better caching
const keepSources = new Set([currentAd?.src, nextAd?.src, prevAd?.src]);
preloadedVideos.current.forEach((video, src) => {
  if (!keepSources.has(src)) {
    console.log('[VIDEO CACHE] Marking for cleanup:', src);
  }
});
```

## Performance Improvements

### ✅ **Loading Time Reduction**
- **Immediate loading** untuk video pertama
- **Background preloading** untuk semua video
- **Priority-based** loading strategy

### ✅ **Seamless Transitions**
- **Ready state checking** sebelum switch
- **Preloaded video usage** untuk instant play
- **Fallback mechanism** untuk error handling

### ✅ **User Experience**
- **Loading indicators** untuk visual feedback
- **Auto-skip** pada error
- **Smooth playback** tanpa buffering

### ✅ **Memory Efficiency**
- **Extended caching** untuk better reuse
- **Smart cleanup** strategy
- **Staggered loading** untuk avoid memory spike

### ✅ **Network Optimization**
- **Browser preload hints** untuk early fetching
- **CrossOrigin** support untuk CDN
- **Progress tracking** untuk monitoring

## Monitoring & Debugging

### 📊 **Cache Statistics**
```typescript
// Enhanced cache stats dengan video count
<div>Settings: {settingsCache.size()}/20 | Videos: {preloadedVideos.current.size}</div>
```

### 🔍 **Console Logging**
- `[VIDEO CACHE]` - Video preloading activities
- `[AD VIDEO]` - Video playback events
- `[SEAMLESS PRELOAD]` - Transition preparations
- `[IMMEDIATE PRELOAD]` - First video loading

### 📈 **Performance Metrics**
- Video ready state monitoring
- Buffer progress tracking
- Loading time measurement
- Error rate tracking

Dengan implementasi ini, loading video ads menjadi **significantly faster** dengan preloading yang aggressive dan smart caching strategy yang memastikan video siap dimainkan saat dibutuhkan.
