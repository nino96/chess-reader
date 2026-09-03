import type { MouseEvent, ReactNode } from 'react';

function handleSkipLinkClick(event: MouseEvent<HTMLAnchorElement>) {
  const main = document.getElementById('main');
  if (main) {
    event.preventDefault();
    main.focus();
  }
}

const appVersion: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

export interface AppFrameProps {
  children: ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  return (
    <div data-testid="app-shell" className="app-shell">
      {/*
        WebKit/Safari omit plain links from the Tab sequence unless the user enables
        full keyboard access. An explicit tabIndex keeps the skip link the first Tab stop
        in every engine without changing its semantics.
      */}
      <a href="#main" className="skip-link" tabIndex={0} onClick={handleSkipLinkClick}>
        Skip to main content
      </a>
      <header data-testid="app-header" className="app-header">
        <h1>Chess Reader</h1>
        <p className="app-tagline">Read and study your own chess books, entirely on this device.</p>
      </header>
      <main id="main" tabIndex={-1} className="app-main">
        <div className="app-main-grid">{children}</div>
      </main>
      <footer data-testid="app-footer" className="app-footer">
        <p>
          Chess Reader &middot; {import.meta.env.MODE} &middot; v{appVersion}
        </p>
      </footer>
    </div>
  );
}
