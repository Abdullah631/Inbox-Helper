import { GithubIcon, InboxIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="site-header">
      <div className="container">
        <div className="brand">
          <div className="brand-mark"><InboxIcon width={17} height={17} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">Inbox Helper</div>
            <div className="brand-sub">Sort candidate messages. Review every reply.</div>
          </div>
        </div>
        <div className="header-actions">
          <a className="btn btn-ghost" href="https://github.com/Abdullah631/Inbox-Helper" target="_blank" rel="noreferrer"
            aria-label="Source on GitHub" title="Source on GitHub">
            <GithubIcon />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
