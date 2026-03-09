import type { ReactNode } from "react";

interface SidebarProps {
  tabs: { label: string; path: string }[];
  activeTab: string;
  onTabChange: (path: string) => void;
  action?: ReactNode;
  children: ReactNode;
}

export function Sidebar({ tabs, activeTab, onTabChange, action, children }: SidebarProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="top-tab-bar">
        {tabs.map((tab) => (
          <button
            key={tab.path}
            className={activeTab === tab.path ? "active" : ""}
            onClick={() => onTabChange(tab.path)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {action && (
        <div className="p-3 border-b border-edge">
          {action}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
