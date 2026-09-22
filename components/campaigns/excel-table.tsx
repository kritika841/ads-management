"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { RotateCcw, Table as TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ExcelColumnDef<T> = {
  id: string;
  header: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  align?: "left" | "center" | "right";
  cell: (item: T, rowIndex: number) => React.ReactNode;
  headerTooltip?: string;
  sortableValue?: (item: T) => string | number;
};

export function getExcelColumnLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

export type RowHeightMode = "compact" | "standard" | "tall" | "autofit";

export function ExcelTable<T>({
  columns,
  data,
  title,
  subtitle,
  emptyMessage = "No records found.",
  onRowClick,
  rowClassName,
  storageKey,
  rightActions,
  getRowKey,
  defaultRowHeight = 46
}: {
  columns: ExcelColumnDef<T>[];
  data: T[];
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  rowClassName?: (item: T, index: number) => string;
  storageKey?: string;
  rightActions?: React.ReactNode;
  getRowKey?: (item: T, index: number) => string | number;
  defaultRowHeight?: number;
}) {
  // Initialize column widths
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    columns.forEach((col) => {
      initial[col.id] = col.defaultWidth ?? 160;
    });
    return initial;
  });

  // Track base row height, per-row custom heights, and mode
  const [rowHeightMode, setRowHeightMode] = useState<RowHeightMode>("standard");
  const [baseRowHeight, setBaseRowHeight] = useState<number>(defaultRowHeight);
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({});

  // Column drag resize state
  const resizingCol = useRef<{ colId: string; startX: number; startWidth: number } | null>(null);
  const [activeColResize, setActiveColResize] = useState<string | null>(null);

  // Row drag resize state for individual rows
  const resizingRow = useRef<{ rowIndex: number; startY: number; startHeight: number } | null>(null);
  const [activeRowResizeIndex, setActiveRowResizeIndex] = useState<number | null>(null);

  // Load saved widths and individual row heights from localStorage if key provided
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const savedCols = localStorage.getItem(`excel_cols_${storageKey}`);
      if (savedCols) {
        setColWidths((prev) => ({ ...prev, ...JSON.parse(savedCols) }));
      }
      const savedBaseHeight = localStorage.getItem(`excel_base_h_${storageKey}`);
      if (savedBaseHeight) {
        const val = parseInt(savedBaseHeight, 10);
        if (!isNaN(val) && val >= 32) setBaseRowHeight(val);
      }
      const savedRowHeights = localStorage.getItem(`excel_row_heights_${storageKey}`);
      if (savedRowHeights) {
        setRowHeights(JSON.parse(savedRowHeights));
      }
      const savedMode = localStorage.getItem(`excel_row_m_${storageKey}`) as RowHeightMode | null;
      if (savedMode && ["compact", "standard", "tall", "autofit"].includes(savedMode)) {
        setRowHeightMode(savedMode);
      }
    } catch {
      // ignore
    }
  }, [storageKey]);

  // Save widths
  const saveColWidths = useCallback(
    (widths: Record<string, number>) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        localStorage.setItem(`excel_cols_${storageKey}`, JSON.stringify(widths));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  const saveRowHeights = useCallback(
    (heights: Record<number, number>) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        localStorage.setItem(`excel_row_heights_${storageKey}`, JSON.stringify(heights));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  const saveRowConfig = useCallback(
    (baseH: number, mode: RowHeightMode) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        localStorage.setItem(`excel_base_h_${storageKey}`, String(baseH));
        localStorage.setItem(`excel_row_m_${storageKey}`, mode);
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  // Mouse move / up handlers for column resizing
  const onColMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!resizingCol.current) return;
      const { colId, startX, startWidth } = resizingCol.current;
      const delta = e.clientX - startX;
      const targetCol = columns.find((c) => c.id === colId);
      const minW = targetCol?.minWidth ?? 35;
      const maxW = targetCol?.maxWidth ?? 1600;
      const newWidth = Math.min(maxW, Math.max(minW, startWidth + delta));
      setColWidths((prev) => ({ ...prev, [colId]: newWidth }));
    },
    [columns]
  );

  const onColMouseUp = useCallback(() => {
    if (resizingCol.current) {
      setColWidths((latest) => {
        saveColWidths(latest);
        return latest;
      });
      resizingCol.current = null;
      setActiveColResize(null);
    }
    window.removeEventListener("mousemove", onColMouseMove);
    window.removeEventListener("mouseup", onColMouseUp);
  }, [onColMouseMove, saveColWidths]);

  const startColResize = (colId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = {
      colId,
      startX: e.clientX,
      startWidth: colWidths[colId] ?? 160
    };
    setActiveColResize(colId);
    window.addEventListener("mousemove", onColMouseMove);
    window.addEventListener("mouseup", onColMouseUp);
  };

  // Mouse move / up handlers for individual row resizing
  const onRowMouseMove = useCallback((e: MouseEvent) => {
    if (!resizingRow.current) return;
    const { rowIndex, startY, startHeight } = resizingRow.current;
    const delta = e.clientY - startY;
    const newHeight = Math.max(34, Math.min(1000, startHeight + delta));
    setRowHeights((prev) => ({ ...prev, [rowIndex]: newHeight }));
    setRowHeightMode("standard");
  }, []);

  const onRowMouseUp = useCallback(() => {
    if (resizingRow.current) {
      setRowHeights((latest) => {
        saveRowHeights(latest);
        return latest;
      });
      resizingRow.current = null;
      setActiveRowResizeIndex(null);
    }
    window.removeEventListener("mousemove", onRowMouseMove);
    window.removeEventListener("mouseup", onRowMouseUp);
  }, [onRowMouseMove, saveRowHeights]);

  const startRowResize = (rowIndex: number, rowElement: HTMLElement | null, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentHeight = rowElement?.offsetHeight ?? (rowHeights[rowIndex] ?? baseRowHeight);
    resizingRow.current = {
      rowIndex,
      startY: e.clientY,
      startHeight: currentHeight
    };
    setActiveRowResizeIndex(rowIndex);
    window.addEventListener("mousemove", onRowMouseMove);
    window.addEventListener("mouseup", onRowMouseUp);
  };

  const handleSetRowMode = (mode: RowHeightMode) => {
    setRowHeightMode(mode);
    let targetBase = baseRowHeight;
    if (mode === "compact") targetBase = 38;
    else if (mode === "standard") targetBase = defaultRowHeight;
    else if (mode === "tall") targetBase = 92;
    setBaseRowHeight(targetBase);
    // Reset individual row height overrides when explicitly selecting a uniform preset
    setRowHeights({});
    saveRowConfig(targetBase, mode);
    if (storageKey && typeof window !== "undefined") {
      try {
        localStorage.removeItem(`excel_row_heights_${storageKey}`);
      } catch {
        // ignore
      }
    }
  };

  const resetSizing = () => {
    const initial: Record<string, number> = {};
    columns.forEach((col) => {
      initial[col.id] = col.defaultWidth ?? 160;
    });
    setColWidths(initial);
    setBaseRowHeight(defaultRowHeight);
    setRowHeights({});
    setRowHeightMode("standard");
    if (storageKey && typeof window !== "undefined") {
      try {
        localStorage.removeItem(`excel_cols_${storageKey}`);
        localStorage.removeItem(`excel_base_h_${storageKey}`);
        localStorage.removeItem(`excel_row_heights_${storageKey}`);
        localStorage.removeItem(`excel_row_m_${storageKey}`);
      } catch {
        // ignore
      }
    }
  };

  const totalTableWidth = columns.reduce((acc, col) => acc + (colWidths[col.id] ?? col.defaultWidth ?? 160), 44);

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card shadow-soft overflow-hidden">
      {/* Workbook Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded bg-primary/15 text-primary font-bold text-xs">
            <TableIcon className="size-4" />
          </div>
          <div>
            {title ? <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3> : null}
            {subtitle ? <p className="text-[11px] text-muted-foreground leading-none mt-0.5">{subtitle}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Row Height Presets */}
          <div className="flex items-center gap-0.5 border border-border rounded-lg bg-background/80 p-0.5 text-xs shadow-2xs">
            <span className="text-[11px] text-muted-foreground px-1.5 font-medium select-none">Row:</span>
            <button
              type="button"
              onClick={() => handleSetRowMode("compact")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition select-none",
                rowHeightMode === "compact"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title="Compact baseline rows (38px)"
            >
              Compact
            </button>
            <button
              type="button"
              onClick={() => handleSetRowMode("standard")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition select-none",
                rowHeightMode === "standard"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={`Standard baseline rows (${baseRowHeight}px)`}
            >
              Standard
            </button>
            <button
              type="button"
              onClick={() => handleSetRowMode("tall")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition select-none",
                rowHeightMode === "tall"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title="Tall baseline rows (92px)"
            >
              Tall
            </button>
            <button
              type="button"
              onClick={() => handleSetRowMode("autofit")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition select-none",
                rowHeightMode === "autofit"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title="Auto-fit row heights to reveal full content inline"
            >
              Auto-fit
            </button>
          </div>

          {rightActions}
          <Button
            size="sm"
            variant="ghost"
            onClick={resetSizing}
            title="Reset column widths and row heights to defaults"
            className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
          >
            <RotateCcw className="size-3.5 mr-1" />
            Reset
          </Button>
        </div>
      </div>

      {/* Spreadsheet Container */}
      <div className="relative overflow-x-auto overflow-y-auto max-h-[75vh] select-none-during-resize">
        <table
          className="border-collapse text-xs w-full text-foreground table-fixed"
          style={{ minWidth: `${totalTableWidth}px` }}
        >
          {/* Column definitions */}
          <colgroup>
            {/* Row Number Column */}
            <col style={{ width: "42px" }} />
            {columns.map((col) => (
              <col key={col.id} style={{ width: `${colWidths[col.id] ?? col.defaultWidth ?? 160}px` }} />
            ))}
          </colgroup>

          {/* Table Header (clean, without A B C D letters) */}
          <thead>
            <tr className="border-b border-border bg-muted/70 text-muted-foreground font-semibold sticky top-0 z-20 shadow-2xs">
              {/* Row number corner */}
              <th className="sticky left-0 z-30 w-11 border-r border-border bg-muted/90 p-1 text-center font-mono text-[10px] uppercase text-muted-foreground select-none">
                #
              </th>
              {columns.map((col) => {
                const colW = colWidths[col.id] ?? col.defaultWidth ?? 160;
                return (
                  <th
                    key={col.id}
                    title={col.headerTooltip ?? col.header}
                    style={{
                      width: `${colW}px`,
                      minWidth: `${colW}px`,
                      maxWidth: `${colW}px`
                    }}
                    className="relative border-r border-border px-2.5 py-2.5 text-left font-semibold text-xs select-none group bg-muted/70 hover:bg-muted overflow-hidden"
                  >
                    <div className="flex items-center overflow-hidden">
                      <span className="truncate font-semibold text-foreground text-xs">{col.header}</span>
                    </div>

                    {/* Column Resize Handle - Resizes ONLY this column */}
                    <div
                      onMouseDown={(e) => startColResize(col.id, e)}
                      onDoubleClick={() => {
                        setColWidths((prev) => ({ ...prev, [col.id]: col.defaultWidth ?? 160 }));
                      }}
                      title="Drag to resize this column (double-click to reset)"
                      className={cn(
                        "absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize z-20 transition-colors",
                        "hover:bg-primary/50 group-hover:bg-border/80",
                        activeColResize === col.id && "bg-primary w-1"
                      )}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-border">
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="py-12 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((item, rowIndex) => {
                const thisRowHeight =
                  rowHeightMode === "autofit"
                    ? undefined
                    : rowHeights[rowIndex] ??
                      (rowHeightMode === "compact"
                        ? 38
                        : rowHeightMode === "tall"
                        ? 92
                        : baseRowHeight);

                return (
                  <tr
                    key={getRowKey ? getRowKey(item, rowIndex) : ((item as { id?: string | number })?.id ?? rowIndex)}
                    onClick={() => onRowClick?.(item)}
                    id={`excel-row-${rowIndex}`}
                    style={
                      thisRowHeight
                        ? {
                            height: `${thisRowHeight}px`,
                            maxHeight: `${thisRowHeight}px`
                          }
                        : undefined
                    }
                    className={cn(
                      "group relative transition-colors hover:bg-muted/30",
                      onRowClick && "cursor-pointer",
                      rowClassName?.(item, rowIndex)
                    )}
                  >
                    {/* Row Number Header */}
                    <td
                      style={
                        thisRowHeight
                          ? {
                              height: `${thisRowHeight}px`,
                              maxHeight: `${thisRowHeight}px`
                            }
                          : undefined
                      }
                      className="sticky left-0 z-10 w-11 border-r border-border bg-muted/40 group-hover:bg-muted/70 p-1 text-center font-mono text-[11px] text-muted-foreground relative select-none align-top"
                    >
                      <span className="block pt-1">{rowIndex + 1}</span>

                      {/* Row Resize Handle - Dragging adjusts ONLY this specific row */}
                      <div
                        onMouseDown={(e) => {
                          const tr = document.getElementById(`excel-row-${rowIndex}`);
                          startRowResize(rowIndex, tr, e);
                        }}
                        onDoubleClick={() => {
                          setRowHeights((prev) => {
                            const next = { ...prev };
                            delete next[rowIndex];
                            saveRowHeights(next);
                            return next;
                          });
                        }}
                        title="Drag to resize this row height (double-click to reset)"
                        className={cn(
                          "absolute left-0 right-0 bottom-0 h-2 cursor-row-resize z-20 hover:bg-primary/50",
                          activeRowResizeIndex === rowIndex && "bg-primary h-1"
                        )}
                      />
                    </td>

                    {/* Cell Content with individual row height and space fulfillment */}
                    {columns.map((col) => {
                      const colW = colWidths[col.id] ?? col.defaultWidth ?? 160;
                      return (
                        <td
                          key={col.id}
                          style={{
                            width: `${colW}px`,
                            minWidth: `${colW}px`,
                            maxWidth: `${colW}px`,
                            height: thisRowHeight ? `${thisRowHeight}px` : undefined,
                            maxHeight: thisRowHeight ? `${thisRowHeight}px` : undefined
                          }}
                          className={cn(
                            "border-r border-border px-2.5 py-1.5 text-xs align-top overflow-hidden",
                            col.align === "center" && "text-center",
                            col.align === "right" && "text-right"
                          )}
                        >
                          <div
                            className="w-full max-w-full h-full overflow-hidden break-words"
                            style={
                              thisRowHeight
                                ? { maxHeight: `${thisRowHeight - 12}px` }
                                : undefined
                            }
                          >
                            {col.cell(item, rowIndex)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Spreadsheet Status / Footer bar */}
      <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
        <div>
          <span>
            {data.length} item{data.length === 1 ? "" : "s"} · {columns.length} columns
          </span>
        </div>
      </div>
    </div>
  );
}
