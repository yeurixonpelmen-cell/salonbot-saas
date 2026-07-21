import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  return <button {...props} className={`ui-button ui-button-${variant} ${className}`} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ui-input ${className}`} />;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="ui-overlay" onMouseDown={onClose}>
      <section className="ui-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="ui-panel-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрити">×</button>
        </header>
        <div className="ui-panel-body">{children}</div>
      </section>
    </div>
  );
}

export function Drawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="ui-overlay" onMouseDown={onClose}>
      <aside className="ui-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header className="ui-panel-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрити">×</button>
        </header>
        <div className="ui-panel-body">{children}</div>
      </aside>
    </div>
  );
}
