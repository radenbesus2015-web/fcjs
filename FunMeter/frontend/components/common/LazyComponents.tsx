// components/common/LazyComponents.tsx
// Lazy loading components for performance optimization

"use client";

import React, { Suspense, lazy, ComponentType, ReactNode, useEffect, useState, useRef } from 'react';
import { useLazyLoad } from '@/lib/cache';

// Loading skeleton components
export const LoadingSkeleton = ({ 
  className = "animate-pulse bg-muted rounded",
  height = "h-4",
  width = "w-full"
}: {
  className?: string;
  height?: string;
  width?: string;
}) => (
  <div className={`${className} ${height} ${width}`} />
);

export const TableSkeleton = ({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) => (
  <div className="space-y-3">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex space-x-4">
        {Array.from({ length: cols }).map((_, j) => (
          <LoadingSkeleton key={j} className="flex-1" />
        ))}
      </div>
    ))}
  </div>
);

export const CardSkeleton = () => (
  <div className="p-4 border rounded-lg space-y-3">
    <LoadingSkeleton height="h-6" width="w-3/4" />
    <LoadingSkeleton height="h-4" width="w-full" />
    <LoadingSkeleton height="h-4" width="w-2/3" />
  </div>
);

export const GridSkeleton = ({ items = 6 }: { items?: number }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {Array.from({ length: items }).map((_, i) => (
      <CardSkeleton key={i} />
    ))}
  </div>
);

// Lazy wrapper with intersection observer
interface LazyWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
  threshold?: number;
  rootMargin?: string;
  className?: string;
  minHeight?: string;
}

export const LazyWrapper = ({
  children,
  fallback = <LoadingSkeleton height="h-32" />,
  threshold = 0.1,
  rootMargin = '100px',
  className = '',
  minHeight = 'min-h-[100px]'
}: LazyWrapperProps) => {
  const { ref, isVisible } = useLazyLoad(threshold, rootMargin);

  return (
    <div ref={ref} className={`${className} ${minHeight}`}>
      {isVisible ? children : fallback}
    </div>
  );
};

// Virtual list component for large datasets
interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  className?: string;
}

export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
  className = ''
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollElementRef = useRef<HTMLDivElement>(null);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(startIndex, endIndex + 1);
  const totalHeight = items.length * itemHeight;
  const offsetY = startIndex * itemHeight;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return (
    <div
      ref={scrollElementRef}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, index) => (
            <div key={startIndex + index} style={{ height: itemHeight }}>
              {renderItem(item, startIndex + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Lazy image component with loading states
interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  fallback?: ReactNode;
  loadingClassName?: string;
  errorClassName?: string;
}

export const LazyImage = ({
  src,
  alt,
  fallback,
  loadingClassName = 'animate-pulse bg-muted',
  errorClassName = 'bg-muted flex items-center justify-center text-muted-foreground',
  className = '',
  ...props
}: LazyImageProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { ref, isVisible } = useLazyLoad();

  const handleLoad = () => {
    setLoading(false);
    setError(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  return (
    <div ref={ref} className={className}>
      {!isVisible ? (
        fallback || <div className={loadingClassName} style={{ aspectRatio: '16/9' }} />
      ) : error ? (
        <div className={errorClassName} style={{ aspectRatio: '16/9' }}>
          <span className="text-sm">Failed to load</span>
        </div>
      ) : (
        <>
          {loading && (
            <div className={loadingClassName} style={{ aspectRatio: '16/9' }} />
          )}
          <img
            src={src}
            alt={alt}
            onLoad={handleLoad}
            onError={handleError}
            className={loading ? 'hidden' : className}
            {...props}
          />
        </>
      )}
    </div>
  );
};

// Progressive enhancement wrapper
interface ProgressiveProps {
  children: ReactNode;
  fallback?: ReactNode;
  delay?: number;
}

export const Progressive = ({ 
  children, 
  fallback = <LoadingSkeleton />, 
  delay = 100 
}: ProgressiveProps) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return show ? <>{children}</> : <>{fallback}</>;
};

// Lazy route component
export const createLazyRoute = <P extends object = {}>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  fallback?: ReactNode
) => {
  const LazyComponent = lazy(importFn);
  
  return (props: P) => (
    <Suspense fallback={fallback || <LoadingSkeleton height="h-screen" />}>
      <LazyComponent {...props} />
    </Suspense>
  );
};

// Lazy modal component
interface LazyModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

export const LazyModal = ({ isOpen, onClose, children, title }: LazyModalProps) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (isOpen && !mounted) {
      setMounted(true);
    }
  }, [isOpen, mounted]);

  if (!mounted) return null;

  return (
    <Suspense fallback={<LoadingSkeleton height="h-64" />}>
      {children}
    </Suspense>
  );
};

// Debounced component renderer
interface DebouncedProps {
  children: ReactNode;
  delay?: number;
  dependencies?: unknown[];
}

export const Debounced = ({ children, delay = 300, dependencies = [] }: DebouncedProps) => {
  const [debouncedChildren, setDebouncedChildren] = useState(children);
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setDebouncedChildren(children);
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [children, delay, ...dependencies]);

  return <>{debouncedChildren}</>;
};

// Memoized heavy component wrapper
export const MemoizedWrapper = React.memo(({ 
  children,
  dependencies = []
}: {
  children: ReactNode;
  dependencies?: unknown[];
}) => {
  return <>{children}</>;
}, (prevProps, nextProps) => {
  // Custom comparison logic
  return JSON.stringify(prevProps.dependencies) === JSON.stringify(nextProps.dependencies);
});

// Chunk loader for code splitting
export const ChunkLoader = ({ 
  chunk,
  fallback = <LoadingSkeleton />
}: {
  chunk: () => Promise<{ default: ComponentType }>;
  fallback?: ReactNode;
}) => {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chunk()
      .then(module => {
        setComponent(() => module.default);
        setLoading(false);
      })
      .catch(error => {
        console.error('Failed to load chunk:', error);
        setLoading(false);
      });
  }, [chunk]);

  if (loading) return <>{fallback}</>;
  if (!Component) return <div>Failed to load component</div>;

  return <Component />;
};

export default {
  LazyWrapper,
  VirtualList,
  LazyImage,
  Progressive,
  createLazyRoute,
  LazyModal,
  Debounced,
  MemoizedWrapper,
  ChunkLoader,
  LoadingSkeleton,
  TableSkeleton,
  CardSkeleton,
  GridSkeleton
};
