import { AppFrame } from './app/AppFrame';
import { InstallPanel } from './app/InstallPanel';
import { CapabilityDiagnostics } from './capabilities/CapabilityDiagnostics';
import { StudyWorkspace } from './study/StudyWorkspace';

export function App() {
  return (
    <AppFrame>
      <div className="app-main-full">
        <StudyWorkspace />
      </div>
      <div className="app-main-primary">
        <InstallPanel />
      </div>
      <CapabilityDiagnostics />
    </AppFrame>
  );
}
