import { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Downloader } from './components/Downloader';
import { Onboarding } from './components/Onboarding';
import { AnimatePresence } from 'framer-motion';

function App() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const settings = await window.electron.getSettings();
        if (!settings.onboardingCompleted) {
          setShowOnboarding(true);
        }
      } catch (error) {
        console.error("Failed to load onboarding state:", error);
      } finally {
        setLoading(false);
      }
    };
    checkOnboarding();
  }, []);

  const handleOnboardingComplete = async () => {
    try {
      const settings = await window.electron.getSettings();
      await window.electron.saveSettings({ ...settings, onboardingCompleted: true });
    } catch (error) {
      console.error("Failed to save onboarding state:", error);
    }
    setShowOnboarding(false);
  };

  if (loading) {
    return <div className="h-screen w-screen bg-[#0a0a0b]" />;
  }

  return (
    <>
      <TitleBar />
      <Downloader />
      <AnimatePresence>
        {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
      </AnimatePresence>
    </>
  );
}

export default App;
