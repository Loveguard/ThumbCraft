import { Component, type ReactNode } from 'react'

/**
 * Last line of defence: a bug in any panel shows this instead of a blank window. The scene is autosaved,
 * so reloading brings the user back to it through Recent projects. With `area`, it guards one part of the window
 * (the Animate panel, the timeline): the rest keeps working and Try again puts that part back.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode; area?: string }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: Error): { error: string } {
    return { error: e.message || String(e) }
  }
  componentDidCatch(e: Error): void {
    console.error(e)
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const { area } = this.props
    return (
      <div className={area ? 'app-error area-error' : 'app-error'}>
        <strong>{area ? `The ${area} hit a problem.` : 'Something went wrong in ThumbCraft.'}</strong>
        <span>{this.state.error}</span>
        <span>
          {area
            ? 'Your scene is safe. Try again, or reload if it keeps happening.'
            : 'Your work is autosaved. Reload, then open it again from Recent projects.'}
        </span>
        <div className="row">
          {area && (
            <button className="primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          )}
          <button className={area ? 'ghost' : 'primary'} onClick={() => window.location.reload()}>
            Reload ThumbCraft
          </button>
        </div>
      </div>
    )
  }
}
