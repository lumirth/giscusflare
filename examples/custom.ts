import { mountPresentation, type Page } from "giscusflare/headless";
import { stockContent } from 'giscusflare/content/stock';
import { forumPresentation } from "./forum.js";
const params = new URLSearchParams(location.search),
  repo = params.get("repo"),
  number = Number(params.get("number"));
if (repo && number) {
  const page: Page = {
    repo,
    selector: { kind: "discussion", number },
    origin: location.origin,
    pageURL: location.href,
    returnURL: location.href,
    description: "",
  };
  mountPresentation(
    document.getElementById("conversation")!,
    { service: location.origin, content: stockContent({service: location.origin}), page,appearance:{theme:"light"} },
    forumPresentation,
  );
} else
  document.getElementById("conversation")!.textContent =
    "Supply ?repo=owner/repository&number=1 for an allowed public discussion.";
