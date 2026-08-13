export interface TabInfo {
  path: string
  name: string
  dirty: boolean
}

interface TabBarProps {
  tabs: TabInfo[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

export function TabBar({ tabs, activePath, onSelect, onClose }: TabBarProps): JSX.Element {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className={`tab${tab.path === activePath ? ' active' : ''}`}
          onClick={() => onSelect(tab.path)}
          title={tab.path}
        >
          <span className="tab-name">
            {tab.name}
            {tab.dirty ? ' •' : ''}
          </span>
          <button
            className="tab-close"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab.path)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
