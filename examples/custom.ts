import { mountPresentation, type Widget } from "giscusflare/headless";
import { forumPresentation } from "./forum.js";
const params = new URLSearchParams(location.search),
  repo = params.get("repo"),
  number = Number(params.get("number"));
if (repo && number) {
  const page: Page = {
    repo,
    number,
    term: "",
    repoId: "",
    category: params.get("category") || "Announcements",
    categoryId: "",
    strict: false,
    origin: location.href,
    backLink: "",
    description: "",
  };
  mountPresentation(
    document.getElementById("conversation")!,
    { service: location.origin, page,appearance:{theme:"light"} },
    forumPresentation,
  );
} else
  document.getElementById("conversation")!.textContent =
    "Supply ?repo=owner/repository&number=1 for an allowed public discussion.";
