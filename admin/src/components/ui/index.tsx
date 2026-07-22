import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  RefObject,
  useEffect,
  useRef,
} from 'react';

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  return <button type={type} {...props} className={`ui-button ui-button-${variant} ${className}`} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ui-input ${className}`} />;
}

function usePanelHotkeys(onClose: () => void) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const root = panelRef.current;
      if (!root) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Enter') return;

      const target = event.target as HTMLElement | null;
      if (!target || !root.contains(target)) return;
      if (target.tagName === 'BUTTON' || target.tagName === 'A') return;
      if (target.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) return;

      const form = target.closest('form') ?? root.querySelector('form');
      if (!form) return;

      const submit = form.querySelector<HTMLButtonElement>(
        'button[type="submit"]:not([disabled])'
      );
      if (!submit) return;

      event.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit(submit);
      else submit.click();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return panelRef;
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
  const panelRef = usePanelHotkeys(onClose);

  return (
    <div className="ui-overlay" onMouseDown={onClose}>
      <section
        ref={panelRef as RefObject<HTMLElement>}
        className="ui-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
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
  const panelRef = usePanelHotkeys(onClose);

  return (
    <div className="ui-overlay" onMouseDown={onClose}>
      <aside
        ref={panelRef as RefObject<HTMLElement>}
        className="ui-drawer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ui-panel-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрити">×</button>
        </header>
        <div className="ui-panel-body">{children}</div>
      </aside>
    </div>
  );
}
