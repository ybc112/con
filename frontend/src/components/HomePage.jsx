import { motion } from 'framer-motion';
import { FiArrowRight, FiAward, FiCheckCircle, FiGift, FiTrendingUp, FiUsers, FiZap } from 'react-icons/fi';
import { formatNumber } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

export default function HomePage({ onPageChange, stakingData }) {
  const { t } = useLanguage();
  const miningStatus = stakingData?.miningStatus;

  const stats = [
    { label: t('cz.home.statStaked'), value: miningStatus?.totalStaked || '0', suffix: 'CON', icon: <FiTrendingUp /> },
    { label: t('cz.home.statDistributed'), value: miningStatus?.totalDistributed || '0', suffix: 'CON', icon: <FiGift /> },
    { label: t('cz.home.statNodes'), value: miningStatus?.rankedNodeCount ?? 0, suffix: t('cz.common.nodes'), icon: <FiUsers /> },
  ];
  const isLoading = stakingData?.loading !== false;

  const bands = [
    { rank: t('cz.home.bandTop10'), share: '50%', note: t('cz.home.noteCore') },
    { rank: t('cz.home.band11To50'), share: '30%', note: t('cz.home.noteClimb') },
    { rank: t('cz.home.band51To100'), share: '15%', note: t('cz.home.noteGrowth') },
    { rank: t('cz.home.bandAfter100'), share: '5%', note: t('cz.home.noteUniversal') },
  ];

  return (
    <div className="space-y-7 md:space-y-16">
      <section className="relative overflow-hidden rounded-2xl md:rounded-[2rem] min-h-0 md:min-h-[72vh] flex items-center py-6 sm:py-10 md:py-0">
        <div className="absolute inset-0 overflow-hidden rounded-2xl md:rounded-[2rem]">
          <img src="/con-logo.png" alt="CON" className="absolute right-[-120px] top-[42%] -translate-y-1/2 w-[360px] h-[360px] sm:right-[-90px] sm:w-[420px] sm:h-[420px] md:w-[620px] md:h-[620px] rounded-full object-cover opacity-20 md:opacity-25 blur-[1px] animate-float" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0B1120] via-[#0B1120]/90 to-[#0B1120]/40" />
          {/* 动态光晕装饰（科技蓝，克制收敛） */}
          <div className="absolute -left-24 top-10 w-72 h-72 rounded-full bg-[#2563EB]/12 blur-[90px] animate-pulse-glow pointer-events-none" />
          <div className="absolute right-[-60px] bottom-[-40px] w-96 h-96 rounded-full bg-[#38BDF8]/10 blur-[110px] animate-pulse-glow pointer-events-none" style={{ animationDelay: '1.2s' }} />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="relative w-full max-w-4xl px-4 md:px-6"
        >
          <div className="badge-glow mb-4 md:mb-7 animate-pulse-glow">
            <FiCheckCircle className="w-4 h-4 mr-2" />
            {t('cz.home.badge')}
          </div>

          <h1 className="text-[2.15rem] sm:text-6xl md:text-7xl font-bold leading-[1.08] mb-4 md:mb-6">
            <span className="text-gradient text-[1.05em] tracking-tight">Constellation</span>
            <br />
            <span className="text-gradient-gold">{t('cz.home.title2')}</span>
          </h1>

          <p className="text-base sm:text-2xl text-white/65 leading-relaxed max-w-3xl mb-5 md:mb-8">
            {t('cz.home.intro1')}
            <br />
            {t('cz.home.intro2')}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-4">
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={() => onPageChange('token-mining')} className="btn-premium w-full sm:w-auto">
              <span className="flex items-center justify-center gap-2 whitespace-nowrap">{t('cz.home.viewRank')} <FiArrowRight className="w-5 h-5" /></span>
            </motion.button>
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={() => onPageChange('referral')} className="btn-ghost w-full sm:w-auto">
              <span className="flex items-center justify-center gap-2 whitespace-nowrap"><FiUsers className="w-5 h-5" /> {t('cz.home.inviteFriends')}</span>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => onPageChange('token-mining')}
              className="btn-ghost w-full sm:w-auto col-span-2 sm:col-span-1 border-[#FFB800]/50 bg-[#FFB800]/10 text-[#FFB800] hover:border-[#FFB800] hover:bg-[#FFB800]/20 hover:shadow-[0_0_30px_rgba(255,184,0,0.18)]"
            >
              <span className="flex items-center justify-center gap-2 whitespace-nowrap"><FiZap className="w-5 h-5" /> {t('cz.home.goStake')}</span>
            </motion.button>
          </div>
        </motion.div>
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-6">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={`stat-card-premium min-w-0 ${index === 2 ? 'col-span-2 sm:col-span-1' : ''}`}
          >
            <div className="flex items-start gap-2 text-[#FFB800] mb-2 md:mb-3">
              <span className="shrink-0 mt-0.5">{stat.icon}</span>
              <span className="text-white/45 text-xs sm:text-sm leading-snug">{stat.label}</span>
            </div>
            <div className="text-xl sm:text-3xl font-bold text-gradient-gold number-display break-words">
              {isLoading ? (
                <span className="inline-block w-8 h-4 bg-white/10 rounded animate-pulse" />
              ) : (
                <>
                  {formatNumber(stat.value, 4)}
                  <span className="text-white/40 text-xs sm:text-sm ml-1">{stat.suffix}</span>
                </>
              )}
            </div>
          </motion.div>
        ))}
      </section>

      <section className="grid lg:grid-cols-[0.9fr_1.1fr] gap-6">
        <div className="neon-card">
          <div className="neon-card-inner h-full">
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-4 sm:mb-5 flex items-center gap-3">
              <FiZap className="text-[#FFB800]" />
              {t('cz.home.mechanismTitle')}
            </h2>
            <div className="space-y-3 sm:space-y-4 text-sm sm:text-base text-white/65 leading-relaxed">
              <p>{t('cz.home.mechanism1')}</p>
              <p>{t('cz.home.mechanism2')}</p>
              <p>{t('cz.home.mechanism3')}</p>
            </div>
          </div>
        </div>

        <div className="glass-premium p-5 md:p-6">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-4 sm:mb-5 flex items-center gap-3">
            <FiAward className="text-[#38BDF8]" />
            {t('cz.home.monthlyTitle')}
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {bands.map((band, index) => (
              <motion.div
                key={band.rank}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15 + index * 0.08 }}
                className="p-5 rounded-xl bg-white/5 border border-white/10"
              >
                <div className="text-white/50 text-sm">{band.rank}</div>
                <div className="text-4xl font-bold text-gradient-gold my-2">{band.share}</div>
                <div className="text-white/35 text-sm">{band.note}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
