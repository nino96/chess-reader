import { AppFrame } from './app/AppFrame';
import { InstallPanel } from './app/InstallPanel';
import { LibraryEmptyState } from './app/LibraryEmptyState';
import { CapabilityDiagnostics } from './capabilities/CapabilityDiagnostics';

export function App() {
  return (
    <AppFrame>
      <div className="app-main-primary">
        <LibraryEmptyState />
        <InstallPanel />
      </div>
      <CapabilityDiagnostics />
    </AppFrame>
  );
}
