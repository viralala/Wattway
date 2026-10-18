/**
 * WattWay · Team Kothimbir 🌿
 * ui.tsx — the small reusable pieces every page is built from (buttons, cards,
 * sliders, tables, dashed dividers). Styles live in styles/components.css.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
}

export function Button({ variant = 'primary', small, className = '', ...rest }: ButtonProps) {
  return <button className={`btn btn-${variant}${small ? ' btn-sm' : ''} ${className}`} {...rest} />;
}

export function LinkButton({
  to,
  variant = 'primary',
  small,
  children,
}: {
  to: string;
  variant?: Variant;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={`btn btn-${variant}${small ? ' btn-sm' : ''}`}>
      {children}
    </Link>
  );
}

export function Card({
  icon,
  title,
  children,
  to,
}: {
  icon?: string;
  title: string;
  children: ReactNode;
  to?: string;
}) {
  const body = (
    <>
      {icon && (
        <div className="card-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3>{title}</h3>
      {children}
    </>
  );
  return to ? (
    <Link to={to} className="card">
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
}

interface SliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  warning?: string;
  disabled?: boolean;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

/** Accessible range input: label, live value, optional hint / warning. */
export function Slider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  hint,
  warning,
  disabled,
  format,
  onChange,
}: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100;
  const shown = format ? format(value) : `${value}${unit}`;
  const describedBy = warning ? `${id}-warn` : hint ? `${id}-hint` : undefined;
  return (
    <div className="slider">
      <div className="slider-top">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{shown}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ['--fill' as string]: `${fill}%` }}
        aria-describedby={describedBy}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {warning ? (
        <small id={`${id}-warn`} className="warn" role="status">
          {warning}
        </small>
      ) : (
        hint && <small id={`${id}-hint`}>{hint}</small>
      )}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  numeric?: boolean;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty = 'Nothing to show yet.',
}: {
  caption?: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
}) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption ?? 'Data table'}>
      <table className="table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : undefined}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Hand-drawn dashed trail, used between sections. */
export function RouteDivider({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      className="route-divider"
      viewBox="0 0 1200 36"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M0 18 C 120 2, 200 34, 340 18 S 560 2, 700 20 S 960 34, 1080 16 S 1170 10, 1200 18" />
    </svg>
  );
}

export function PageHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}
