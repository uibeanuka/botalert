import Link from 'next/link';
import { useRouter } from 'next/router';

const NAV_ITEMS = [
  {
    href: '/',
    label: 'Home',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 11l9-7 9 7" />
        <path d="M9 22V12h6v10" />
      </svg>
    )
  },
  {
    href: '/dca',
    label: 'DCA',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19h16" />
        <path d="M7 19V5l4 4 4-4v14" />
      </svg>
    )
  },
  {
    href: '/ai-insights',
    label: 'AI',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    )
  }
];

export default function BottomNav() {
  const router = useRouter();

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">
        {NAV_ITEMS.map((item) => {
          const isActive = router.pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`bottom-nav-link ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="bottom-nav-icon">{item.icon}</span>
              <span className="bottom-nav-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
