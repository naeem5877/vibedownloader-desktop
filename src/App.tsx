import { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Downloader } from './components/Downloader';
import { Onboarding } from './components/Onboarding';
import { AnimatePresence } from 'framer-motion';

function App() {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const hasOnboarded = localStorage.getItem('vibe_onboarding_completed');
    if (!hasOnboarded) {
      setShowOnboarding(true);
    }
  }, []);

  const handleOnboardingComplete = () => {
    localStorage.setItem('vibe_onboarding_completed', 'true');
    setShowOnboarding(false);
  };

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
