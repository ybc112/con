import { FiHome, FiTrendingUp, FiUsers, FiShield } from 'react-icons/fi';
import { useLanguage } from '../contexts/LanguageContext';

const NAV = [
  { id: 'home', icon: FiHome, key: 'home' },
  { id: 'token-mining', icon: FiTrendingUp, key: 'tokenMining' },
  { id: 'referral', icon: FiUsers, key: 'referral' },
  { id: 'admin', icon: FiShield, key: 'admin' },
];

// 移动端底部 Tab 导航：当前项金色高亮 + 底部金色指示条（仅 md 以下显示）
export default function MobileTabBar({ currentPage, onPageChange, isAdmin }) {
  const { t } = useLanguage();

  const items = NAV.filter((item) => item.id !== 'admin' || isAdmin);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 tab-bar">
      <div className="flex items-stretch">
        {items.map((item) => {
          const active = currentPage === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors duration-300 ${active ? 'text-[#FFB800]' : 'text-white/45 hover:text-white/70'}`}
            >
              <Icon className={`w-5 h-5 transition-transform duration-300 ${active ? 'scale-110 drop-shadow-[0_0_8px_rgba(255,184,0,0.6)]' : ''}`} />
              <span className={`text-[10px] font-medium ${active ? 'font-bold' : ''}`}>{t(`header.${item.key}`)}</span>
              <span
                className={`absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] rounded-t-full bg-gradient-to-r from-[#FFB800] to-[#FF8A00] transition-all duration-300 ${
                  active ? 'w-10 opacity-100 shadow-[0_0_12px_rgba(255,184,0,0.7)]' : 'w-0 opacity-0'
                }`}
              />
              {active && (
                <span className="absolute inset-0 -z-10 bg-gradient-to-t from-[#FFB800]/12 to-transparent pointer-events-none" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
