const probe = async (url) => {
  try {
    const r = await fetch(url, { redirect: "manual" });
    const loc = r.headers.get("location");
    console.log(`  ${r.status}${loc ? ` -> ${loc.slice(0, 90)}` : ""}   ${url}`);
    return r.status;
  } catch (e) {
    console.log(`  ERR ${e.message}   ${url}`);
    return 0;
  }
};

console.log("production routes (unauthenticated, so a redirect to login is the healthy answer):");
for (const p of ["/", "/my-work", "/projects", "/timesheets", "/auth/login"]) {
  await probe(`https://hseportal.hs-experts.com${p}`);
}
