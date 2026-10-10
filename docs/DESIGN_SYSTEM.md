# DramaGo Design System

Status: Active for v0.5.0 public documentation site.

## Direction

DramaGo uses a neutral, compact, evidence-driven interface inspired by open-source product and technical documentation patterns. It does not copy GitHub trademarks, logos, proprietary illustrations or brand identity.

## Foundations

- System UI font stack for interface text.
- Monospace stack for code, operations, status fields and identifiers.
- Semantic Light, Dark and System themes.
- One-pixel borders, 6–12px radii and two restrained shadows.
- No glow-heavy backgrounds, 3D transforms or oversized gradient typography.

The canonical tokens live in [`assets/tokens.css`](assets/tokens.css).

## Semantic color roles

- Canvas: `--canvas-default`, `--canvas-subtle`, `--canvas-inset`
- Foreground: `--fg-default`, `--fg-muted`, `--fg-subtle`
- Border: `--border-default`, `--border-muted`
- Accent: `--accent-fg`, `--accent-emphasis`, `--accent-muted`
- State: success, attention and danger token families

Components consume semantic roles rather than embedding theme-specific colors.

## Radius and shadow

- `--radius-small: 6px`
- `--radius-medium: 8px`
- `--radius-large: 12px`
- `--shadow-small`
- `--shadow-medium`

## Components

The shared CSS provides Button, IconButton, Label, StateLabel, Counter, Card, Panel, Nav, Sidebar, Breadcrumb, Tabs, CodeBlock, Callout, CheckRow, Metric, Timeline, ReleaseEntry and DecisionCard patterns.

## Accessibility

- Semantic landmarks and headings.
- Skip link on every page.
- Visible `:focus-visible` ring.
- Keyboard-operable menu and theme control.
- Text remains available without JavaScript.
- Motion is removed for `prefers-reduced-motion`.
- Tables and code blocks scroll within their own containers.
- Layout remains usable at 320px.

## Theme behavior

System is the default. A saved user choice is stored in `localStorage` under `dramago-theme`. A small inline head script applies an explicit saved theme before paint; the shared script handles later changes.
