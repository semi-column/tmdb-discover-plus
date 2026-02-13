import { useState } from 'react';

export function useInstall() {
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installData, setInstallData] = useState(null);

  return { showInstallModal, setShowInstallModal, installData, setInstallData };
}
