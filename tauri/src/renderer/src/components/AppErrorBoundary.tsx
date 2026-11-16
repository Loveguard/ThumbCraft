import { Component, type ReactNode } from 'react'

/**
 * Last line of defence: a bug in any panel shows this instead of a blank window. The scene is autosaved,
 * so reloading brings the user back to it through Recent projects.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: Error): { error: string } {
    return { error: e.message || String(e) }
  }
  componentDidCatch(e: Error): void {
    console.error(e)
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="app-error">
        <strong>Something went wrong in ThumbCraft.</strong>
        <span>{this.state.error}</span>
        <span>Your work is autosaved. Reload, then open it again from Recent projects.</span>
        <button className="primary" onClick={() => window.location.reload()}>
          Reload ThumbCraft
        </button>
      </div>
    )
  }
}
