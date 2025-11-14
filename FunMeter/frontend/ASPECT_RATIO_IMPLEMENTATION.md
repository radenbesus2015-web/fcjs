# Implementasi Aspect Ratio Responsif

## Overview
Implementasi aspect ratio responsif menggunakan "Padding-Top Hack" untuk memastikan konsistensi layout di berbagai ukuran layar dan orientasi.

## Teknik Padding-Top Hack

### Konsep Dasar
Padding-top hack menggunakan persentase padding-top untuk mempertahankan aspect ratio yang konsisten:
- Padding dalam persentase dihitung berdasarkan **width** dari parent container
- Formula: `padding-top = (height / width) * 100%`

### Contoh Perhitungan Aspect Ratio
```css
/* 1:1 aspect ratio */
.aspect-1-1 { padding-top: 100%; }      /* 1/1 = 100% */

/* 4:3 aspect ratio */
.aspect-4-3 { padding-top: 75%; }       /* 3/4 = 75% */

/* 3:2 aspect ratio */
.aspect-3-2 { padding-top: 66.67%; }    /* 2/3 = 66.67% */

/* 16:9 aspect ratio */
.aspect-16-9 { padding-top: 56.25%; }   /* 9/16 = 56.25% */

/* Custom ratios untuk project ini */
.aspect-40-4 { padding-top: 10%; }      /* 4/40 = 10% (header) */
.aspect-40-2 { padding-top: 5%; }       /* 2/40 = 5% (footer) */
.aspect-24-3 { padding-top: 12.5%; }    /* 3/24 = 12.5% (landscape header) */
.aspect-24-2 { padding-top: 8.33%; }    /* 2/24 = 8.33% (landscape footer) */
```

## Struktur HTML yang Diimplementasikan

### 1. Banner Sections (Header & Footer)
```jsx
<section id="banner_top">
  <div className="banner-top-container">
    <div className="aspect-ratio-content">
      <Image src="/assets/header/header.png" fill />
    </div>
  </div>
</section>
```

### 2. Video Section
```jsx
<section id="camera">
  <div className="video-container">
    <div id="camera-host">
      <video />
      <canvas />
    </div>
  </div>
</section>
```

### 3. Advertisement Overlay
```jsx
<div className="ad-overlay-container">
  <Image /> {/* atau <video /> */}
</div>
```

## CSS Implementation

### Base Aspect Ratio Container
```css
.aspect-ratio-container {
  position: relative;
  width: 100%;
  height: 0;
  overflow: hidden;
}

.aspect-ratio-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
```

### Responsive Breakpoints

#### Header Banner
- **Portrait**: 40:4 ratio (10% padding-top)
- **Landscape**: 24:3 ratio (12.5% padding-top)

#### Footer Banner  
- **Portrait**: 40:2 ratio (5% padding-top)
- **Landscape**: 24:2 ratio (8.33% padding-top)

#### Video Container
- **Portrait**: 9:16 ratio
- **Landscape**: 16:9 ratio
- **Ultra-wide**: 21:9 ratio

#### Advertisement Overlay
- **Default**: 4:3 ratio (75% padding-top)
- **Alternative formats**: 16:9, 1:1, 3:2

## Performance Optimizations

### 1. Layout Containment
```css
.aspect-ratio-container,
.banner-top-container,
.banner-bottom-container,
.ad-overlay-container {
  contain: layout style;
  will-change: auto;
}
```

### 2. Hardware Acceleration
```css
.page-root {
  contain: layout;
  transform: translateZ(0);
  backface-visibility: hidden;
}
```

### 3. High DPI Support
```css
@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
  .banner-top-container img,
  .banner-bottom-container img {
    image-rendering: -webkit-optimize-contrast;
    image-rendering: crisp-edges;
  }
}
```

## Accessibility Features

### 1. Reduced Motion Support
```css
@media (prefers-reduced-motion: reduce) {
  .ad-overlay-container,
  .video-container {
    will-change: auto;
    transform: none;
  }
}
```

### 2. High Contrast Mode
```css
@media (prefers-contrast: high) {
  .page-root {
    background: #000;
  }
  
  #banner_top {
    border-bottom: 2px solid #fff;
  }
  
  #banner_bottom {
    border-top: 2px solid #fff;
  }
}
```

## Browser Compatibility

### Modern Browsers
Menggunakan CSS `aspect-ratio` property untuk browser yang mendukung.

### Fallback untuk Browser Lama
```css
@supports not (aspect-ratio: 1) {
  .video-container {
    padding-top: 56.25%; /* 16:9 fallback */
    height: 0;
  }
  
  .video-container video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
}
```

## Keuntungan Implementasi

### 1. **Konsistensi Layout**
- Aspect ratio tetap konsisten di semua ukuran layar
- Tidak ada layout shift saat loading content

### 2. **Performance**
- Menggunakan CSS containment untuk optimasi rendering
- Hardware acceleration untuk smooth animations

### 3. **Responsivitas**
- Otomatis menyesuaikan dengan orientasi device
- Support untuk berbagai aspect ratio layar

### 4. **Maintainability**
- Utility classes yang dapat digunakan kembali
- Struktur CSS yang terorganisir dan modular

### 5. **Accessibility**
- Support untuk reduced motion preferences
- High contrast mode compatibility
- Semantic HTML structure

## Testing Checklist

- [ ] Portrait mode (9:16, 3:4, dll)
- [ ] Landscape mode (16:9, 21:9, dll)
- [ ] Mobile devices (320px - 768px)
- [ ] Tablet devices (768px - 1024px)
- [ ] Desktop screens (1024px+)
- [ ] Ultra-wide monitors (21:9+)
- [ ] High DPI displays (Retina, 4K)
- [ ] Accessibility preferences (reduced motion, high contrast)

## Maintenance Notes

1. **Aspect Ratio Values**: Semua nilai padding-top dihitung dengan formula `(height/width) * 100%`
2. **Media Queries**: Gunakan orientation-based queries untuk responsive behavior
3. **Performance**: Monitor layout containment dan will-change properties
4. **Browser Support**: Test fallback untuk browser yang tidak support aspect-ratio
