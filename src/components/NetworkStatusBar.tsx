import React from 'react';

interface Props {
  isOnline: boolean;
  isConnected: boolean;
  lang: 'ar' | 'en';
}

const NetworkStatusBar: React.FC<Props> = ({ isOnline, isConnected, lang }) => {
  if (isOnline && isConnected) return null;

  const bg = !isOnline ? 'bg-rose-600' : 'bg-amber-500';
  const text = !isOnline
    ? (lang === 'ar' ? '📡 أنت غير متصل بالإنترنت' : '📡 No internet connection')
    : (lang === 'ar' ? '⏳ جاري الاتصال بالخادم...' : '⏳ Connecting to server...');

  return (
    <div className={`fixed top-0 left-0 right-0 z-[200] ${bg} text-white text-center py-2 text-xs font-bold shadow-lg`}>
      {text}
    </div>
  );
};

export default NetworkStatusBar;
