import { useCallback, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { useDismiss } from '../lib/useDismiss';
import { EmptyStateBody } from './ui/EmptyState';
import { Select } from './ui/Select';
import { AnchoredMenu, MenuItem, useMenuNavigation } from './ui/Menu';

/**
 * Data table shell: rounded clipped container, sticky tinted header, hairline row
 * dividers and a soft cyan hover wash. Rows come from `TableRow`/`TableCell`.
 *
 * Columns opt into sorting with `sortable: true`; the parent owns the comparator
 * and receives the requested key through `onSort`.
 *
 * The companion primitives in this file exist so every table in the product shows
 * identity, row actions, filters, selection and paging the same way:
 *   TableToolbar      filter row above the table
 *   TableSelectionBar bulk actions, shown only while rows are selected
 *   TableIdentity     avatar + name + secondary line
 *   TableActions      overflow menu for row actions
 *   TablePagination   range label and pager
 */
export function GlassTable({
  columns,
  children,
  emptyIcon,
  emptyTitle,
  emptyMessage,
  emptyAction,
  loading,
  skeletonRows = 5,
  sortKey,
  sortDir = 'asc',
  onSort,
  maxHeight,
  className = '',
  /*
   * Pages that give this wrapper its own overflow-y (the .admin-page-locked
   * layouts — currently just Tickets) need Lenis kept out of the vertical
   * axis too, not just horizontal: those routes run with the page-level
   * Lenis scroller stopped, and Lenis still calls preventDefault() on any
   * wheel/touch gesture over an element that isn't explicitly exempted —
   * data-lenis-prevent-horizontal alone doesn't cover that. Everywhere else
   * this must stay off: it's what makes the table "grow with the page"
   * instead of getting its own scrollbar (see the comment below).
   */
  fillsAvailableHeight = false,
}) {
  const hasRows = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : Boolean(children);

  return (
    <div className={cn('ui-table-shell', className)}>
      {/*
        Horizontal overflow stays on this wrapper so wide tables don't push the page.
        Vertical overflow is left visible: long tables grow with the page instead of
        creating a second scrollbar. Pass maxHeight only when a capped region is required.
      */}
      <div
        className="ui-table-scroll"
        style={maxHeight ? { maxHeight } : undefined}
        {...(fillsAvailableHeight ? { 'data-lenis-prevent': true } : { 'data-lenis-prevent-horizontal': true })}
      >
        <table className="min-w-full">
          <thead className="ui-table-head sticky top-0 z-10">
            <tr>
              {columns.map((col) => {
                const sortable = Boolean(col.sortable && onSort);
                const active = sortable && sortKey === col.key;
                /*
                 * Only the sorted column keeps a visible arrow. GitHub and Stripe both
                 * hide the neutral indicator until hover, because a full row of grey
                 * arrows reads as decoration and buries the one that matters.
                 */
                const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;

                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn('ui-th text-left', col.className)}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.key)}
                        className={cn('ui-th-sortable group/th', active && 'text-accent-600')}
                      >
                        {col.label}
                        <Icon
                          className={cn(
                            'h-3 w-3 shrink-0 transition-opacity duration-fast',
                            active ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-60 group-focus/th:opacity-60'
                          )}
                          strokeWidth={2.25}
                          aria-hidden
                        />
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }).map((_, i) => (
                  <tr key={i} className="h-[52px] border-b border-hairline-soft last:border-b-0">
                    {columns.map((col) => (
                      <td key={col.key} className="ui-table-cell">
                        <div className="skeleton h-3.5 w-full max-w-[8rem] rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              : children}
          </tbody>
        </table>
      </div>
      {!loading && !hasRows && emptyMessage && (
        <TableEmpty icon={emptyIcon} title={emptyTitle} message={emptyMessage} action={emptyAction} />
      )}
    </div>
  );
}

/** Shared in-table empty state so every table fails the same way. */
export function TableEmpty({ icon = Inbox, title, message, hint, action }) {
  return (
    <EmptyStateBody
      icon={icon}
      title={title}
      description={message}
      hint={hint}
      action={action}
      size="sm"
      className="px-4 py-12"
    />
  );
}

export function TableRow({ children, className = '', selected = false, onClick }) {
  return (
    <tr
      className={cn('ui-table-row', selected && 'ui-table-row-selected', onClick && 'cursor-pointer', className)}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function TableCell({ children, className = '' }) {
  return <td className={cn('ui-table-cell', className)}>{children}</td>;
}

/** Kept in JS because the portalled menu is positioned, not laid out. */
const MENU_WIDTH = 184;

const initialsOf = (value) =>
  String(value || '')
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s._-]+/)
    .filter((part) => /[a-z]/i.test(part))
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || 'U';

/**
 * Identity cell: 32px avatar, name, and one secondary line. Standardising this is
 * what makes a person look the same in every table instead of each page inventing
 * its own avatar size and email styling.
 */
export function TableIdentity({ name, secondary, onClick, tone = 'accent', size = 'md' }) {
  const Tag = onClick ? 'button' : 'div';
  const palette =
    tone === 'neutral' ? 'bg-slate-100 text-slate-500' : 'bg-sky-50 text-sky-600';
  const tiny = size === 'xs';
  const compact = size === 'sm' || tiny;

  return (
    <Tag
      data-identity
      title={name}
      {...(onClick ? { type: 'button', onClick } : {})}
      className={cn(
        'group flex min-w-0 items-center text-left',
        tiny ? 'gap-1.5' : 'gap-2.5',
        onClick && 'cursor-pointer'
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full font-semibold uppercase',
          tiny ? 'h-6 w-6 text-[9px]' : compact ? 'h-8 w-8 text-[10px]' : 'h-9 w-9 text-xs',
          palette
        )}
        aria-hidden
      >
        {initialsOf(name)}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'block truncate transition-colors',
            tiny ? 'text-xs font-medium text-slate-700' : 'text-sm font-semibold text-slate-800',
            onClick && 'group-hover:text-sky-600'
          )}
        >
          {name}
        </span>
        {secondary && <span className="block truncate text-xs text-slate-400">{secondary}</span>}
      </span>
    </Tag>
  );
}

/**
 * Row overflow menu. Three inline buttons per row turn a table into a wall of
 * controls, so actions collapse behind one trigger and the row keeps its data.
 * Pass the most common action as `primary` to keep it inline.
 */
export function TableActions({ items = [], label = 'Row actions' }) {
  const [placement, setPlacement] = useState(null);
  const triggerRef = useRef(null);
  const usable = items.filter(Boolean);
  const open = Boolean(placement);

  /* Closing puts focus back on the trigger so the row keeps its place in tab order. */
  const close = useCallback(() => {
    setPlacement((current) => {
      if (current) triggerRef.current?.focus();
      return null;
    });
  }, []);

  const { containerRef: menuRef, onKeyDown } = useMenuNavigation({ open, onClose: close });
  const rootRef = useDismiss(close, menuRef);

  /*
   * The menu is portalled and fixed-positioned because the table shell clips its
   * overflow — anchored inside the row, the last row's menu would be cut in half.
   */
  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = usable.length * 36 + 8;
    const flip = rect.bottom + height + 8 > window.innerHeight;
    setPlacement({
      left: Math.max(8, rect.right - MENU_WIDTH),
      top: flip ? rect.top - height - 4 : rect.bottom + 4,
    });
  };

  if (usable.length === 0) return null;

  return (
    <div ref={rootRef} className="flex justify-end">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="ui-row-action"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>

      <AnchoredMenu
        open={open}
        onClose={close}
        placement={placement}
        width={MENU_WIDTH}
        label={label}
        containerRef={menuRef}
        onKeyDown={onKeyDown}
      >
        {usable.map((item) => (
          <MenuItem
            key={item.label}
            icon={item.icon}
            tone={item.tone}
            disabled={item.disabled}
            onSelect={() => {
              close();
              item.onClick?.();
            }}
          >
            {item.label}
          </MenuItem>
        ))}
      </AnchoredMenu>
    </div>
  );
}

/** Filter row above a table: search on the left, filters next, actions right. */
export function TableToolbar({ search, filters, actions }) {
  return (
    <div className="ui-toolbar flex flex-col gap-3 rounded-[18px] border p-3 xl:flex-row xl:items-center">
      {search && <div className="relative w-full xl:max-w-xs">{search}</div>}
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
      {actions && <div className="flex items-center gap-2 xl:ml-auto xl:shrink-0">{actions}</div>}
    </div>
  );
}

/**
 * Bulk action bar. Only rendered while something is selected — GitHub swaps the
 * table chrome for this rather than parking permanently-disabled bulk buttons in
 * the toolbar, which is what this replaces.
 */
export function TableSelectionBar({ count, onClear, children }) {
  if (!count) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-accent-200 bg-accent-50 px-3 py-2.5">
      <span className="text-label font-semibold text-accent-600">
        {count} selected
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-accent-600 transition-colors hover:bg-white/70"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        Clear
      </button>
    </div>
  );
}

/**
 * Pager. Shows the visible range rather than only page numbers, because "1-25 of
 * 240" answers the question a page number cannot.
 */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [25, 50, 100],
  className = '',
}) {
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const current = Math.min(page, pageCount);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  /* A window around the current page keeps the control a fixed width on long lists. */
  const windowStart = Math.max(1, Math.min(current - 1, pageCount - 2));
  const pages = [windowStart, windowStart + 1, windowStart + 2].filter((value) => value >= 1 && value <= pageCount);

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 px-1', className)}>
      <p className="text-xs font-medium tabular-nums text-slate-400">
        {total === 0 ? 'No results' : `Showing ${from}–${to} of ${total}`}
      </p>

      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
            Rows per page
            <Select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              size="sm"
              className="w-auto"
              aria-label="Rows per page"
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        )}

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="ui-pager-btn"
            onClick={() => onPageChange(current - 1)}
            disabled={current <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          {pages.map((value) =>
            value === current ? (
              <span key={value} className="ui-pager-current" aria-current="page">
                {value}
              </span>
            ) : (
              <button key={value} type="button" className="ui-pager-btn" onClick={() => onPageChange(value)}>
                {value}
              </button>
            )
          )}
          <button
            type="button"
            className="ui-pager-btn"
            onClick={() => onPageChange(current + 1)}
            disabled={current >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
