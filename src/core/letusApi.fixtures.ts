/**
 * LETUS本番の実測データを匿名化したfixture（2026-07-07実測）。
 * 設計: docs/superpowers/specs/2026-07-08-letus-api-deadline-hybrid-design.md
 */

/** ログイン済みLETUSページの M.cfg インラインscript断片（sesskeyは10文字英数字・実測形状） */
export const SESSKEY_HTML_SNIPPET = `<html><head><script>
//<![CDATA[
var M = {}; M.yui = {};
M.pageloadstarttime = new Date();
M.cfg = {"wwwroot":"https:\\/\\/letus.ed.tus.ac.jp","sesskey":"AbCd012345","sessiontimeout":"28800","themerev":"1751000000","slasharguments":1,"theme":"classic"};
//]]>
</script></head><body>dashboard</body></html>`
