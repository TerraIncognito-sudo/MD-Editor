import { useState } from 'react'
import type { TreeNode } from '../../../preload/index'

interface FileTreeProps {
  nodes: TreeNode[]
  activePath: string | null
  onSelect: (node: TreeNode) => void
}

export function FileTree({ nodes, activePath, onSelect }: FileTreeProps): JSX.Element {
  return (
    <ul className="tree">
      {nodes.map((node) => (
        <TreeItem key={node.path} node={node} activePath={activePath} onSelect={onSelect} />
      ))}
    </ul>
  )
}

interface TreeItemProps {
  node: TreeNode
  activePath: string | null
  onSelect: (node: TreeNode) => void
}

function TreeItem({ node, activePath, onSelect }: TreeItemProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  if (node.type === 'folder') {
    const isEmpty = !node.children || node.children.length === 0
    return (
      <li className="tree-folder">
        <div className="tree-row folder-row" onClick={() => setExpanded((e) => !e)}>
          <span className="chevron">{isEmpty ? '' : expanded ? '▾' : '▸'}</span>
          <span className="tree-label">{node.name}</span>
        </div>
        {expanded && node.children && (
          <ul className="tree">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                activePath={activePath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const isActive = node.path === activePath
  return (
    <li className="tree-file">
      <div
        className={`tree-row file-row${isActive ? ' active' : ''}`}
        onClick={() => onSelect(node)}
      >
        <span className="tree-label">{node.name.replace(/\.(md|markdown|mdown|mkd|mdx)$/i, '')}</span>
      </div>
    </li>
  )
}
