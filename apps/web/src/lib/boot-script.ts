// No "use client": the layout (a server component) inlines signedInBootScript.
/** Inlined in <head>: on the login/signup pages, someone already signed in on this device goes straight to the
 * dashboard before anything paints. Google's return (?code=) and provider messages (?oauth=) still load the page. */
export const signedInBootScript = `try{var p=location.pathname.replace(/[/]+$/,"");if((p===""||p==="/login"||p==="/signup")&&localStorage.getItem("xocrisk.signedIn")==="1"&&!/[?&](code|error|error_description|oauth)=/.test(location.search))location.replace("/account/")}catch(e){}`;
