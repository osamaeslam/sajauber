import React from 'react';

interface Props {
  isInitializing: boolean;
  lang: 'ar' | 'en';
}

const InitializingOverlay: React.FC<Props> = ({ isInitializing, lang }) => {
  if (!isInitializing) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-[150] flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-amber-400 text-xs font-black">
          {lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}
        </p>
      </div>
    </div>
  );
};

export default InitializingOverlay;
