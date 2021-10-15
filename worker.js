addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

const discordBotToken = DISCORD_BOT_KEY;
const discordClientId = DISCORD_CLIENT_ID;
const discordClientSecret = DISCORD_CLIENT_SECRET;
const kvStorage = L2R_STORAGE;

String.prototype.removePrefix = function (prefix) {
    const hasPrefix = this.indexOf(prefix) === 0;
    return hasPrefix ? this.substr(prefix.length) : this.toString();
};


async function handleRequest(request) {
    const url = new URL(request.url);
    const pathname = url.pathname.removePrefix('/api');
    
    if(pathname === "/join") {
        const link = url.searchParams.get('state');
        if(!link) return new Response("Missing `state` (link) argument", {status:400})
        let access_token = url.searchParams.get('access_token');
        if(access_token === null) {
            const code = url.searchParams.get('code');
            if(!code) return new Response("Missing `code` argument", {status:400})
            const authBody = {
                client_id: discordClientId,
                client_secret: discordClientSecret,
                grant_type: 'authorization_code',
                redirect_uri: 'https://link2role.svoka.com/api/join',
                code: code,
            };
            const authResponse = await fetch("https://discord.com/api/oauth2/token",  {
                body: new URLSearchParams(Object.entries(authBody)).toString(),
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                    accept: "application/json",
                },
            });
            if(authResponse.status >= 400) return authResponse;
            const authData = await authResponse.json();
            access_token=authData.access_token
            // return Response.redirect(`https://link2role.svoka.com/api/join?access_token=${access_token}&state=${link}`, 307)
        }
        const userIdResponse = await fetch("https://discord.com/api/v6/users/@me", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${access_token}`,
                accept: "application/json",
            },
        })
        if(userIdResponse.status >= 400) return userIdResponse;
        const userIdData = await userIdResponse.json()
        const linkDataJson = await kvStorage.get(link)
        if(linkDataJson === null) return new Response("Link not found. It is missing or was deleted", {status:404})
        const data = JSON.parse(linkDataJson)

        const addResponse = await fetch(`https://discord.com/api/v6/guilds/${data.guild}/members/${userIdData.id}`, {
            method: "PUT",
            body: JSON.stringify({
                access_token: access_token,
                roles: [data.role],
            }),
            headers: {
                "content-type": "application/json",
                Authorization: `Bot ${discordBotToken}`,
            },
        });

        const grantResponse = await fetch(`https://discord.com/api/v6/guilds/${data.guild}/members/${userIdData.id}/roles/${data.role}`, {
            method: "PUT",
            body: "",
            headers: {
                Authorization: `Bot ${discordBotToken}`,
            },
        });
        if (grantResponse.status === 204) {
            if(data.su) {
                await kvStorage.delete(link)
            }
            let redirectURL = "http://link2role.svoka.com/success/";
            const instantInviteResponse = await fetch(`https://discord.com/api/v6/guilds/${data.guild}/widget.json`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${access_token}`,
                    accept: "application/json",
                },
            })
            if(instantInviteResponse.status < 400) {
                const inviteResponse = await instantInviteResponse.json();
                const inData = JSON.stringify({i:inviteResponse.instant_invite, n:inviteResponse.name})
                redirectURL += btoa(inData)
            }

            return Response.redirect(redirectURL, 307)
        }
        else {
            return new Response(`Error while joining guild! ${grantResponse.text}`, {status:500})
        }
    }
    else if(pathname === "/generate-link") {
        const guild = url.searchParams.get("guild");
        if(!guild) return new Response("Missing `guild` argument", {status:400})
        const role = url.searchParams.get("role");
        if(!role) return new Response("Missing `role` argument", {status:400})
        const del = btoa(crypto.getRandomValues(new Uint8Array(5))).replaceAll("=","")
        const link = btoa(crypto.getRandomValues(new Uint8Array(6))).replaceAll("=","")
        const linkData = {
            del:del,
            guild:guild,
            role:role, 
        };
        if(url.searchParams.get("singleUse") === "true") linkData.su = true;
        await kvStorage.put(link, JSON.stringify(linkData));
        return new Response(JSON.stringify({
            del:del,
            link:link,
        }), {
            headers: {
                "content-type": "application/json",
            },
        });
    } 
    else if(pathname === "/delete") {
        const formData = await request.formData();
        const del = formData.get('del')
        const link = formData.get('link')
        if(!del) return new Response("Missing `delete` form data", {status:400})
        if(!link) return new Response("Missing `link` form data", {status:400})
        const linkDataJson = await kvStorage.get(link)
        if(linkDataJson === null) return new Response("Link not found. It is missing or was deleted", {status:404})
        const data = JSON.parse(linkDataJson)
        if(data.del === del) {
            await kvStorage.delete(link);
            return new Response("Deleted!")
        } else {
            return new Response("Incorrect deletion code!", {status:401})
        }
    }
    else if(pathname === "/discord-admin" ) {
        const discordGuildId = url.searchParams.get("guild_id");
        const response = await fetch(`https://discord.com/api/v6/guilds/${discordGuildId}/roles`, {
            method: "GET",
            headers: {
                accept: "application/json",
                Authorization: `Bot ${discordBotToken}`,
            },
        });
        const roles = await response.json();
        results = { type:"roles", guild:discordGuildId, roles:roles };
        const html = `<!DOCTYPE html>
            <html>
            <body>
            <h1>Login Success</h1>
            <script>
            window.opener.postMessage(JSON.parse('${JSON.stringify(results)}'), '*');
            setTimeout( () => window.close(), 500)
            </script>
            </body>
            </html>`;
        return new Response(html, {
            headers: {
                "content-type": "text/html;charset=UTF-8",
            },
        });
    } 
    else {
        return new Response('Not found!', {
            headers: { 'content-type': 'text/plain' },
            status: 404,
        })
    }
}
