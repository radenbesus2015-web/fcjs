// components/common/Pagination.tsx
// Komponen pagination yang konsisten untuk seluruh aplikasi

"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { useI18n } from "@/components/providers/I18nProvider";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number | "all";
  itemLabel?: string; // e.g., "members", "users", "ads"
  onPageChange: (page: number) => void;
  className?: string;
  showInfo?: boolean; // Show "Showing X-Y of Z items" text
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  itemLabel = "items",
  onPageChange,
  className = "",
  showInfo = true
}: PaginationProps) {
  const { t } = useI18n();
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);

  // Listen for window resize to update pagination responsively
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  // Don't render if there's only one page or no items
  if (totalPages <= 1 || totalItems === 0) {
    return null;
  }

  // Calculate start and end item numbers for "Showing X-Y of Z" text
  const startItem = itemsPerPage === "all" ? 1 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = itemsPerPage === "all" ? totalItems : Math.min(currentPage * itemsPerPage, totalItems);

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  // Responsive page number calculation
  const getMaxVisiblePages = () => {
    if (windowWidth < 480) return 3;      // Mobile: max 3 pages (1 + current + 1)
    if (windowWidth < 640) return 3;      // Small mobile: max 3 pages
    if (windowWidth < 768) return 5;      // Tablet: max 5 pages  
    if (windowWidth < 1024) return 7;     // Desktop small: max 7 pages
    return 9;                             // Desktop large: max 9 pages
  };

  return (
    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 md:gap-0 p-2 sm:p-3 md:p-4 border-t bg-background ${className}`}>
      {/* Left side: Showing info */}
      {showInfo && (
        <div className="text-xs sm:text-sm text-muted-foreground order-2 sm:order-1">
          <span className="hidden sm:inline">
            {t("pagination.showing", "Showing {start}-{end} of {total} {items}", {
              start: startItem,
              end: endItem,
              total: totalItems,
              items: itemLabel
            })}
          </span>
          <span className="sm:hidden">
            {t("pagination.showingMobile", "{start}-{end} of {total}", {
              start: startItem,
              end: endItem,
              total: totalItems
            })}
          </span>
        </div>
      )}

      {/* Right side: Navigation controls */}
      <div className="flex items-center gap-0.5 sm:gap-1 order-1 sm:order-2 w-full sm:w-auto justify-center sm:justify-end overflow-hidden">
        {/* First page button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
          className="h-8 px-1.5 sm:px-2 flex-shrink-0"
          title={t("pagination.first", "First page")}
        >
          <Icon name="ChevronsLeft" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>

        {/* Previous button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrevious}
          disabled={currentPage <= 1}
          className="h-8 px-1.5 sm:px-2 flex-shrink-0"
          title={t("pagination.previous", "Previous page")}
        >
          <Icon name="ChevronLeft" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>

        {/* Page numbers - Responsive */}
        <div className="flex items-center gap-0.5 sm:gap-1 mx-1 sm:mx-2 overflow-hidden max-w-[60vw] sm:max-w-none">
          {(() => {
            const maxVisible = getMaxVisiblePages();
            const pages: (number | string)[] = [];
            const halfVisible = Math.floor(maxVisible / 2);
            
            let startPage = Math.max(1, currentPage - halfVisible);
            let endPage = Math.min(totalPages, currentPage + halfVisible);

            // Adjust if we're near the beginning or end
            if (endPage - startPage + 1 < maxVisible) {
              if (startPage === 1) {
                endPage = Math.min(totalPages, startPage + maxVisible - 1);
              } else {
                startPage = Math.max(1, endPage - maxVisible + 1);
              }
            }

            // Add first page and ellipsis if needed
            if (startPage > 1) {
              pages.push(1);
              if (startPage > 2) {
                pages.push("...");
              }
            }

            // Add visible pages
            for (let i = startPage; i <= endPage; i++) {
              pages.push(i);
            }

            // Add ellipsis and last page if needed
            if (endPage < totalPages) {
              if (endPage < totalPages - 1) {
                pages.push("...");
              }
              pages.push(totalPages);
            }

            return pages.map((page, index) => (
              <React.Fragment key={index}>
                {page === "..." ? (
                  <span className="px-1 sm:px-2 py-1 text-xs sm:text-sm text-muted-foreground">...</span>
                ) : (
                  <Button
                    variant={page === currentPage ? "default" : "outline"}
                    size="sm"
                    onClick={() => onPageChange(page as number)}
                    className="h-7 w-6 sm:h-8 sm:w-7 md:w-8 p-0 text-xs sm:text-sm flex-shrink-0 min-w-0"
                  >
                    {page}
                  </Button>
                )}
              </React.Fragment>
            ));
          })()}
        </div>

        {/* Next button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleNext}
          disabled={currentPage >= totalPages}
          className="h-8 px-1.5 sm:px-2 flex-shrink-0"
          title={t("pagination.next", "Next page")}
        >
          <Icon name="ChevronRight" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>

        {/* Last page button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
          className="h-8 px-1.5 sm:px-2 flex-shrink-0"
          title={t("pagination.last", "Last page")}
        >
          <Icon name="ChevronsRight" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
      </div>
    </div>
  );
}

// Extended pagination with page numbers (for cases where you need more detailed navigation)
interface ExtendedPaginationProps extends PaginationProps {
  showPageNumbers?: boolean;
  maxVisiblePages?: number;
}

export function ExtendedPagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  itemLabel = "items",
  onPageChange,
  className = "",
  showInfo = true,
  showPageNumbers = false,
  maxVisiblePages = 5
}: ExtendedPaginationProps) {
  const { t } = useI18n();
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);

  // Listen for window resize to update pagination responsively
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  if (totalPages <= 1 || totalItems === 0) {
    return null;
  }

  const startItem = itemsPerPage === "all" ? 1 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = itemsPerPage === "all" ? totalItems : Math.min(currentPage * itemsPerPage, totalItems);

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  // Generate page numbers for extended pagination
  const generatePageNumbers = () => {
    if (!showPageNumbers) return [];

    const pages: (number | string)[] = [];
    const halfVisible = Math.floor(maxVisiblePages / 2);
    
    let startPage = Math.max(1, currentPage - halfVisible);
    let endPage = Math.min(totalPages, currentPage + halfVisible);

    // Adjust if we're near the beginning or end
    if (endPage - startPage + 1 < maxVisiblePages) {
      if (startPage === 1) {
        endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
      } else {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }
    }

    // Add first page and ellipsis if needed
    if (startPage > 1) {
      pages.push(1);
      if (startPage > 2) {
        pages.push("...");
      }
    }

    // Add visible pages
    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    // Add ellipsis and last page if needed
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push("...");
      }
      pages.push(totalPages);
    }

    return pages;
  };

  const pageNumbers = generatePageNumbers();

  // Responsive page number calculation for ExtendedPagination
  const getResponsiveMaxPages = () => {
    if (windowWidth < 480) return Math.min(3, maxVisiblePages);      // Mobile: max 3 pages
    if (windowWidth < 640) return Math.min(3, maxVisiblePages);      // Small mobile: max 3 pages
    if (windowWidth < 768) return Math.min(5, maxVisiblePages);      // Tablet: max 5 pages  
    if (windowWidth < 1024) return Math.min(7, maxVisiblePages);     // Desktop small: max 7 pages
    return maxVisiblePages;                                          // Desktop large: use prop value
  };

  // Update page numbers generation to use responsive max pages
  const generateResponsivePageNumbers = () => {
    const pages: (number | string)[] = [];
    const responsiveMaxVisible = getResponsiveMaxPages();
    const halfVisible = Math.floor(responsiveMaxVisible / 2);
    
    let startPage = Math.max(1, currentPage - halfVisible);
    let endPage = Math.min(totalPages, currentPage + halfVisible);

    // Adjust if we're near the beginning or end
    if (endPage - startPage + 1 < responsiveMaxVisible) {
      if (startPage === 1) {
        endPage = Math.min(totalPages, startPage + responsiveMaxVisible - 1);
      } else {
        startPage = Math.max(1, endPage - responsiveMaxVisible + 1);
      }
    }

    // Add first page and ellipsis if needed
    if (startPage > 1) {
      pages.push(1);
      if (startPage > 2) {
        pages.push("...");
      }
    }

    // Add visible pages
    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    // Add ellipsis and last page if needed
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push("...");
      }
      pages.push(totalPages);
    }

    return pages;
  };

  const responsivePageNumbers = generateResponsivePageNumbers();

  return (
    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 md:gap-0 p-2 sm:p-3 md:p-4 border-t bg-background ${className}`}>
      {/* Left side: Showing info */}
      {showInfo && (
        <div className="text-xs sm:text-sm text-muted-foreground order-2 sm:order-1">
          <span className="hidden sm:inline">
            {t("pagination.showing", "Showing {start}-{end} of {total} {items}", {
              start: startItem,
              end: endItem,
              total: totalItems,
              items: itemLabel
            })}
          </span>
          <span className="sm:hidden">
            {t("pagination.showingMobile", "{start}-{end} of {total}", {
              start: startItem,
              end: endItem,
              total: totalItems
            })}
          </span>
        </div>
      )}

      {/* Right side: Navigation controls */}
      <div className="flex items-center gap-0.5 sm:gap-1 order-1 sm:order-2 w-full sm:w-auto justify-center sm:justify-end overflow-hidden">
        {/* First page button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
          className="h-8 px-1.5 sm:px-2 flex-shrink-0"
          title={t("pagination.first", "First page")}
        >
          <Icon name="ChevronsLeft" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>

        {/* Previous button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrevious}
          disabled={currentPage <= 1}
          className="h-8 px-1.5 sm:px-2 flex-shrink-0"
          title={t("pagination.previous", "Previous page")}
        >
          <Icon name="ChevronLeft" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>

        {/* Page numbers (always shown in ExtendedPagination) - Responsive */}
        <div className="flex items-center gap-0.5 sm:gap-1 mx-1 sm:mx-2 overflow-hidden max-w-[60vw] sm:max-w-none">
          {responsivePageNumbers.map((page, index) => (
            <React.Fragment key={index}>
              {page === "..." ? (
                <span className="px-1 sm:px-2 py-1 text-xs sm:text-sm text-muted-foreground">...</span>
              ) : (
                <Button
                  variant={page === currentPage ? "default" : "outline"}
                  size="sm"
                  onClick={() => onPageChange(page as number)}
                  className="h-7 w-6 sm:h-8 sm:w-7 md:w-8 p-0 text-xs sm:text-sm flex-shrink-0 min-w-0"
                >
                  {page}
                </Button>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Next button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleNext}
          disabled={currentPage >= totalPages}
          className="h-8 px-1.5 sm:px-2 flex-shrink-0"
          title={t("pagination.next", "Next page")}
        >
          <Icon name="ChevronRight" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>

        {/* Last page button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
          className="h-8 px-1.5 sm:px-2 flex-shrink-0"
          title={t("pagination.last", "Last page")}
        >
          <Icon name="ChevronsRight" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
      </div>
    </div>
  );
}
