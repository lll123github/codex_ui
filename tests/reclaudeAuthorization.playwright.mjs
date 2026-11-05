import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {chromium,expect} from "@playwright/test";
const evidence="output/qa/reclaude-authorization";
await fs.mkdir(evidence,{recursive:true});
const vite=await createServer({configFile:false,plugins:[react()],server:{host:"127.0.0.1",port:0},logLevel:"error"});
await vite.listen();
const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
const browser=await chromium.launch({headless:true}),results=[];
try {
  for(const mobile of [false,true]){
    const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:1000},serviceWorkers:"block"});
    let operation=null,starts=0,cancels=0;
    const errors=[];
    await context.addInitScript(()=>{Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true});});
    await context.route("**/api/**",async route=>{
      const request=route.request(),url=new URL(request.url());
      if(!url.pathname.startsWith("/api/reclaude/authorization"))return route.abort();
      if(url.pathname.endsWith("/start")){
        const body=request.postDataJSON();assert.match(body.requestId,/^[0-9a-f-]{36}$/);assert.equal(body.orgId,"1");starts++;
        operation={id:body.requestId,orgId:"1",owned:true,phase:"waiting_authorization",startedAt:Date.now(),expiresAt:Date.now()+600000,authorizationUrl:"https://reclaude.ai/cli/auth?state=browser-fixture"};
      }
      if(url.pathname.endsWith("/cancel")){cancels++;operation={...operation,phase:"cancelled",authorizationUrl:undefined};}
      await route.fulfill({json:{data:{enabled:true,organizations:[{orgId:"1",label:"linucong",connected:true}],operation}}});
    });
    await context.route("https://reclaude.ai/**",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:'<!doctype html><meta charset="UTF-8"><h1>模拟设备认证</h1><button>批准</button>'}));
    const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
    await page.goto(origin+"/tests/reclaudeAuthorization.html");
    await page.getByRole("button",{name:"打开重新认证",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"ReClaude 重新认证"});
    await expect(dialog.getByRole("button",{name:"退出并重新登录",exact:true})).toBeEnabled();
    const popupPromise=page.waitForEvent("popup");await dialog.getByRole("button",{name:"退出并重新登录",exact:true}).click();
    const popup=await popupPromise;
    await popup.waitForURL("https://reclaude.ai/cli/auth?state=browser-fixture");
    assert.equal(await popup.evaluate(()=>window.opener===null),true);
    await expect(dialog.getByRole("link",{name:"打开认证页面"})).toHaveAttribute("href","https://reclaude.ai/cli/auth?state=browser-fixture");
    await expect(dialog.getByRole("button",{name:"退出并重新登录",exact:true})).toBeDisabled();assert.equal(starts,1);
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=(mobile?393:1440));
    await page.screenshot({path:`${evidence}/${mobile?"mobile":"desktop"}-authorization.png`});
    await expect(popup.getByRole("heading",{name:"模拟设备认证"})).toBeVisible();
    await popup.getByRole("button",{name:"批准"}).click();operation={...operation,phase:"completed",authorizationUrl:undefined,message:"认证完成"};
    await expect(page.getByText("账号目录已更新",{exact:true})).toBeVisible();
    await expect(dialog.getByRole("button",{name:"退出并重新登录",exact:true})).toBeEnabled();
    const secondPopup=page.waitForEvent("popup");await dialog.getByRole("button",{name:"退出并重新登录",exact:true}).click();const cancelling=await secondPopup;
    await expect(dialog.getByRole("button",{name:"取消认证",exact:true})).toBeVisible();await dialog.getByRole("button",{name:"取消认证",exact:true}).click();
    await expect(dialog.getByRole("status")).toContainText("认证已取消");assert.equal(cancels,1);assert.equal(starts,2);
    await page.evaluate(()=>{window.__backgroundEscape=0;window.addEventListener("keydown",event=>{if(event.key==="Escape")window.__backgroundEscape++;});});
    await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
    assert.equal(await page.evaluate(()=>window.__backgroundEscape),0,"dialog Escape never reaches a background stop-turn shortcut");
    assert.deepEqual(errors,[]);
    results.push({mobile,popupOpenedByUserGesture:true,approvalUrlValidated:true,openerRemoved:true,httpLanUuidFallback:true,loginCompleted:true,cancelCompleted:true,starts,cancels,errors});
    await context.close();
  }
  await fs.writeFile(`${evidence}/results.json`,JSON.stringify({passed:true,cases:results,nativeCliInvocations:0,realAccountLogouts:0},null,2)+"\n");
  console.log(JSON.stringify({passed:true,cases:results,nativeCliInvocations:0,realAccountLogouts:0}));
} finally {await browser.close();await vite.close();}
