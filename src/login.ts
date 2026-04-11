import type { Page } from "playwright";

export type LoginFields = {
  userSelector: string | null;
  passwordSelector: string;
  submitSelector: string | null;
};

export type LoginCredentials = {
  username: string;
  password: string;
};

type InputMeta = {
  selector: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  autocomplete: string;
  domIndex: number;
};

type ButtonMeta = {
  selector: string;
  tag: string;
  type: string;
  text: string;
  isExplicitSubmit: boolean;
};

type PageSnapshot = {
  password: InputMeta | null;
  userCandidates: InputMeta[];
  submitCandidates: ButtonMeta[];
};

const USER_HINT_REGEX = /user|email|login|account|phone|mobile/i;
const SUBMIT_TEXT_REGEX = /log\s*in|sign\s*in|signin|login|continue|submit|enter/i;

/**
 * Snapshot the page: collect the visible password field, candidate user
 * inputs and candidate submit buttons — each with a pre-computed selector and
 * the metadata we need for ranking in Node.
 *
 * This is the only function that touches the DOM. All ranking logic lives in
 * the module-level helpers below, which keeps `detectLoginFields` trivial.
 */
async function snapshotLoginCandidates(page: Page): Promise<PageSnapshot> {
  return await page.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const style = window.getComputedStyle(el as HTMLElement);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const cssPath = (el: Element): string => {
      if ((el as HTMLElement).id) return `#${CSS.escape((el as HTMLElement).id)}`;
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1 && parts.length < 4) {
        const tagName: string = cur.tagName;
        let part = tagName.toLowerCase();
        const nm = (cur as HTMLInputElement).name;
        if (nm) {
          parts.unshift(`${part}[name="${nm}"]`);
          break;
        }
        const parent: Element | null = cur.parentElement;
        if (parent) {
          const sameTag: Element[] = Array.from(parent.children).filter(
            (c: Element) => c.tagName === tagName,
          );
          if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
        cur = parent;
      }
      return parts.join(" > ");
    };

    const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
    const indexOf = (el: Element): number => allInputs.indexOf(el as HTMLInputElement);

    const passwordEl = allInputs.find((el) => el.type === "password" && isVisible(el)) || null;

    const userCandidateTypes = new Set(["email", "text", "tel", ""]);
    const userCandidates = allInputs
      .filter((el) => userCandidateTypes.has(el.type) && isVisible(el))
      .map((el) => ({
        selector: cssPath(el),
        type: el.type,
        name: el.name || "",
        id: el.id || "",
        placeholder: el.placeholder || "",
        autocomplete: el.autocomplete || "",
        domIndex: indexOf(el),
      }));

    const form = passwordEl ? passwordEl.closest("form") : null;
    const scope: Document | HTMLFormElement = form || document;
    const submitCandidates = Array.from(
      scope.querySelectorAll<HTMLElement>(
        'button[type="submit"], input[type="submit"], button:not([type]), button[type="button"], [role="button"]',
      ),
    )
      .filter(isVisible)
      .map((el) => {
        const tag = el.tagName;
        const type =
          tag === "BUTTON"
            ? (el as HTMLButtonElement).type || ""
            : tag === "INPUT"
              ? (el as HTMLInputElement).type || ""
              : "";
        return {
          selector: cssPath(el),
          tag,
          type,
          text: (el.textContent || (el as HTMLInputElement).value || "").trim(),
          isExplicitSubmit:
            (tag === "BUTTON" && type === "submit") || (tag === "INPUT" && type === "submit"),
        };
      });

    return {
      password: passwordEl
        ? {
            selector: cssPath(passwordEl),
            type: passwordEl.type,
            name: passwordEl.name || "",
            id: passwordEl.id || "",
            placeholder: passwordEl.placeholder || "",
            autocomplete: passwordEl.autocomplete || "",
            domIndex: indexOf(passwordEl),
          }
        : null,
      userCandidates,
      submitCandidates,
    };
  });
}

function matchesUserHint(input: InputMeta): boolean {
  const hay = [input.name, input.id, input.placeholder, input.autocomplete]
    .filter(Boolean)
    .join(" ");
  return USER_HINT_REGEX.test(hay);
}

function pickUserField(candidates: InputMeta[], password: InputMeta): InputMeta | null {
  if (candidates.length === 0) return null;
  // 1. Email type wins.
  const email = candidates.find((c) => c.type === "email");
  if (email) return email;
  // 2. Hint match by name/id/placeholder/autocomplete.
  const hinted = candidates.find(matchesUserHint);
  if (hinted) return hinted;
  // 3. Fallback: nearest candidate that appears before the password field.
  const preceding = candidates
    .filter((c) => c.domIndex < password.domIndex)
    .sort((a, b) => b.domIndex - a.domIndex);
  return preceding[0] || null;
}

function pickSubmitButton(candidates: ButtonMeta[]): ButtonMeta | null {
  if (candidates.length === 0) return null;
  // 1. Explicit submit buttons win.
  const explicit = candidates.find((c) => c.isExplicitSubmit);
  if (explicit) return explicit;
  // 2. Button text match.
  const byText = candidates.find((c) => SUBMIT_TEXT_REGEX.test(c.text));
  if (byText) return byText;
  // 3. Any button in scope.
  return candidates[0];
}

/**
 * Detect a login form on the current page.
 *
 * Heuristics:
 *   - A visible `input[type="password"]` is the strongest signal.
 *   - Pair it with the nearest visible text/email/username input (if any).
 *   - Find a submit button (button[type=submit], input[type=submit], or a
 *     button whose text matches login/sign in).
 *
 * Returns `null` if no login form is detected.
 */
export async function detectLoginFields(page: Page): Promise<LoginFields | null> {
  const snapshot = await snapshotLoginCandidates(page);
  if (!snapshot.password) return null;

  const user = pickUserField(snapshot.userCandidates, snapshot.password);
  const submit = pickSubmitButton(snapshot.submitCandidates);

  return {
    userSelector: user ? user.selector : null,
    passwordSelector: snapshot.password.selector,
    submitSelector: submit ? submit.selector : null,
  };
}

/**
 * Fill the detected login fields and submit the form. Waits for navigation
 * or network activity to settle before returning.
 */
export async function performLogin(
  page: Page,
  fields: LoginFields,
  credentials: LoginCredentials,
): Promise<void> {
  if (fields.userSelector) {
    await page.fill(fields.userSelector, credentials.username);
  }
  await page.fill(fields.passwordSelector, credentials.password);

  const navigationPromise = page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => undefined);

  if (fields.submitSelector) {
    await page.click(fields.submitSelector);
  } else {
    // Fallback: press Enter in the password field to submit the form.
    await page.press(fields.passwordSelector, "Enter");
  }

  await navigationPromise;
}
