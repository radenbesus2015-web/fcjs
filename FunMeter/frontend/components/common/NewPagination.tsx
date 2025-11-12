// components/common/NewPagination.tsx
// Komponen pagination dengan style yang diminta: << < 1 .... n > >>

"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/common/Icon";
import { useI18n } from "@/components/providers/I18nProvider";

interface NewPaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number | "all";
  itemLabel?: string;
  onPageChange: (page: number) => void;
  className?: string;
  showInfo?: boolean;
}

export function NewPagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  itemLabel = "items",
  onPageChange,
  className = "",
  showInfo = true
}: NewPaginationProps) {
  const { t } = useI18n();

  // Don't render if there's only one page or no items
  if (totalPages <= 1 || totalItems === 0) {
    return null;
  }

  // Calculate start and end item numbers
  const startItem = itemsPerPage === "all" ? 1 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = itemsPerPage === "all" ? totalItems : Math.min(currentPage * itemsPerPage, totalItems);

  // Generate page numbers with ellipsis logic
  const generatePageNumbers = () => {
    const pages: (number | string)[] = [];
    
    // Always show first page
    pages.push(1);
    
    if (totalPages <= 7) {
      // If total pages <= 7, show all pages
      for (let i = 2; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Complex logic for ellipsis
      if (currentPage <= 4) {
        // Current page is near the beginning: 1 2 3 4 5 ... n
        for (let i = 2; i <= 5; i++) {
          pages.push(i);
        }
        pages.push("...");
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        // Current page is near the end: 1 ... n-4 n-3 n-2 n-1 n
        pages.push("...");
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Current page is in the middle: 1 ... current-1 current current+1 ... n
        pages.push("...");
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push("...");
        pages.push(totalPages);
      }
    }
    
    return pages;
  };

  const pageNumbers = generatePageNumbers();

  return (
    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-t bg-background ${className}`}>
      {/* Left side: Info */}
      {showInfo && (
        <div className="text-sm text-muted-foreground order-2 sm:order-1">
          <span className="hidden sm:inline">
            {t("pagination.showing", "Menampilkan {start}-{end} dari {total} {items}", {
              start: startItem,
              end: endItem,
              total: totalItems,
              items: itemLabel
            })}
          </span>
          <span className="sm:hidden">
            {t("pagination.showingMobile", "{start}-{end} dari {total}", {
              start: startItem,
              end: endItem,
              total: totalItems
            })}
          </span>
        </div>
      )}

      {/* Right side: Navigation */}
      <div className="flex items-center gap-1 order-1 sm:order-2">
        {/* First page button (<<) */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
          className="h-9 px-3"
          title={t("pagination.first", "Halaman pertama")}
        >
          <Icon name="ChevronsLeft" className="h-4 w-4" />
        </Button>

        {/* Previous button (<) */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="h-9 px-3"
          title={t("pagination.previous", "Sebelumnya")}
        >
          <Icon name="ChevronLeft" className="h-4 w-4" />
        </Button>

        {/* Page numbers */}
        <div className="flex items-center gap-1 mx-2">
          {pageNumbers.map((page, index) => (
            <React.Fragment key={index}>
              {page === "..." ? (
                <span className="px-3 py-2 text-sm text-muted-foreground">...</span>
              ) : (
                <Button
                  variant={page === currentPage ? "default" : "outline"}
                  size="sm"
                  onClick={() => onPageChange(page as number)}
                  className="h-9 w-9 p-0 text-sm"
                >
                  {page}
                </Button>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Next button (>) */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="h-9 px-3"
          title={t("pagination.next", "Selanjutnya")}
        >
          <Icon name="ChevronRight" className="h-4 w-4" />
        </Button>

        {/* Last page button (>>) */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
          className="h-9 px-3"
          title={t("pagination.last", "Halaman terakhir")}
        >
          <Icon name="ChevronsRight" className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
