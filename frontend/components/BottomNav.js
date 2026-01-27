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
