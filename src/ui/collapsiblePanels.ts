const STORAGE_PREFIX = "protouniverse.sidebar.collapsed.";

function storedState(key: string): boolean {
  try { return localStorage.getItem(`${STORAGE_PREFIX}${key}`) === "true"; }
  catch { return false; }
}

function saveState(key: string, collapsed: boolean): void {
  try { localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(collapsed)); }
  catch { /* The panels still work when storage is unavailable. */ }
}

export function bindCollapsiblePanels(sidebar: HTMLElement): void {
  for (const [index, section] of [...sidebar.querySelectorAll<HTMLElement>(".sidebar-section")].entries()) {
    const heading = section.querySelector<HTMLHeadingElement>(":scope > h2");
    if (!heading) continue;
    const title = heading.textContent?.trim() || "panel";
    const key = section.getAttribute("aria-label")?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      || `panel-${index}`;
    const content = document.createElement("div");
    content.className = "sidebar-section-content";
    while (heading.nextSibling) content.append(heading.nextSibling);
    section.append(content);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-toggle";
    button.setAttribute("aria-label", `Collapse ${title}`);
    heading.append(button);

    const setCollapsed = (collapsed: boolean): void => {
      section.classList.toggle("is-collapsed", collapsed);
      content.hidden = collapsed;
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${title}`);
      button.textContent = collapsed ? "+" : "−";
    };
    setCollapsed(storedState(key));
    button.addEventListener("click", () => {
      const collapsed = !section.classList.contains("is-collapsed");
      setCollapsed(collapsed);
      saveState(key, collapsed);
    });
  }
}
