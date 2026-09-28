import type { SVGProps } from 'react'

type Node = [tag: string, attrs: Record<string, string>]

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'stroke'> {
  size?: number | string
  stroke?: number | string
}

function icon(name: string, nodes: Node[]) {
  const Component = ({ size = 24, stroke = 2, color = 'currentColor', ...rest }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {nodes.map(([Tag, attrs], i) => (
        <Tag key={i} {...attrs} />
      ))}
    </svg>
  )
  Component.displayName = name
  return Component
}

export const IconAlertTriangle = icon('IconAlertTriangle', [["path",{"d":"M12 9v4"}],["path",{"d":"M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0"}],["path",{"d":"M12 16h.01"}]])
export const IconArrowDown = icon('IconArrowDown', [["path",{"d":"M12 5l0 14"}],["path",{"d":"M18 13l-6 6"}],["path",{"d":"M6 13l6 6"}]])
export const IconArrowUp = icon('IconArrowUp', [["path",{"d":"M12 5l0 14"}],["path",{"d":"M18 11l-6 -6"}],["path",{"d":"M6 11l6 -6"}]])
export const IconBolt = icon('IconBolt', [["path",{"d":"M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"}]])
export const IconChevronDown = icon('IconChevronDown', [["path",{"d":"M6 9l6 6l6 -6"}]])
export const IconChevronUp = icon('IconChevronUp', [["path",{"d":"M6 15l6 -6l6 6"}]])
export const IconDownload = icon('IconDownload', [["path",{"d":"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"}],["path",{"d":"M7 11l5 5l5 -5"}],["path",{"d":"M12 4l0 12"}]])
export const IconFileExport = icon('IconFileExport', [["path",{"d":"M14 3v4a1 1 0 0 0 1 1h4"}],["path",{"d":"M11.5 21h-4.5a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v5m-5 6h7m-3 -3l3 3l-3 3"}]])
export const IconFilter = icon('IconFilter', [["path",{"d":"M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227"}]])
export const IconFilterOff = icon('IconFilterOff', [["path",{"d":"M8 4h12v2.172a2 2 0 0 1 -.586 1.414l-3.914 3.914m-.5 3.5v4l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227"}],["path",{"d":"M3 3l18 18"}]])
export const IconHelp = icon('IconHelp', [["path",{"d":"M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"}],["path",{"d":"M12 17l0 .01"}],["path",{"d":"M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4"}]])
export const IconHistory = icon('IconHistory', [["path",{"d":"M12 8l0 4l2 2"}],["path",{"d":"M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"}]])
export const IconListCheck = icon('IconListCheck', [["path",{"d":"M3.5 5.5l1.5 1.5l2.5 -2.5"}],["path",{"d":"M3.5 11.5l1.5 1.5l2.5 -2.5"}],["path",{"d":"M3.5 17.5l1.5 1.5l2.5 -2.5"}],["path",{"d":"M11 6l9 0"}],["path",{"d":"M11 12l9 0"}],["path",{"d":"M11 18l9 0"}]])
export const IconLogout = icon('IconLogout', [["path",{"d":"M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"}],["path",{"d":"M9 12h12l-3 -3"}],["path",{"d":"M18 15l3 -3"}]])
export const IconMoon = icon('IconMoon', [["path",{"d":"M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008"}]])
export const IconPlayerPlay = icon('IconPlayerPlay', [["path",{"d":"M7 4v16l13 -8l-13 -8"}]])
export const IconPlayerStop = icon('IconPlayerStop', [["path",{"d":"M5 7a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -10"}]])
export const IconPlugConnected = icon('IconPlugConnected', [["path",{"d":"M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5"}],["path",{"d":"M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5"}],["path",{"d":"M3 21l2.5 -2.5"}],["path",{"d":"M18.5 5.5l2.5 -2.5"}],["path",{"d":"M10 11l-2 2"}],["path",{"d":"M13 14l-2 2"}]])
export const IconPlugConnectedX = icon('IconPlugConnectedX', [["path",{"d":"M20 16l-4 4"}],["path",{"d":"M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5"}],["path",{"d":"M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5"}],["path",{"d":"M3 21l2.5 -2.5"}],["path",{"d":"M18.5 5.5l2.5 -2.5"}],["path",{"d":"M10 11l-2 2"}],["path",{"d":"M13 14l-2 2"}],["path",{"d":"M16 16l4 4"}]])
export const IconRefresh = icon('IconRefresh', [["path",{"d":"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"}],["path",{"d":"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"}]])
export const IconSearch = icon('IconSearch', [["path",{"d":"M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"}],["path",{"d":"M21 21l-6 -6"}]])
export const IconSelect = icon('IconSelect', [["path",{"d":"M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14"}],["path",{"d":"M9 11l3 3l3 -3"}]])
export const IconSelector = icon('IconSelector', [["path",{"d":"M8 9l4 -4l4 4"}],["path",{"d":"M16 15l-4 4l-4 -4"}]])
export const IconSquareOff = icon('IconSquareOff', [["path",{"d":"M8 4h10a2 2 0 0 1 2 2v10m-.584 3.412a2 2 0 0 1 -1.416 .588h-12a2 2 0 0 1 -2 -2v-12c0 -.552 .224 -1.052 .586 -1.414"}],["path",{"d":"M3 3l18 18"}]])
export const IconSun = icon('IconSun', [["path",{"d":"M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"}],["path",{"d":"M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"}]])
export const IconCalendar = icon('IconCalendar', [["path",{"d":"M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z"}],["path",{"d":"M16 3v4"}],["path",{"d":"M8 3v4"}],["path",{"d":"M4 11h16"}]])
