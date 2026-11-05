import {useState} from "react";
import {createRoot} from "react-dom/client";
import {ReclaudeAuthorizationDialog} from "../src/ReclaudeAuthorization";
function Fixture(){
  const [open,setOpen]=useState(false),[completed,setCompleted]=useState(false);
  return <><button onClick={()=>setOpen(true)}>打开重新认证</button>{completed?<p>账号目录已更新</p>:null}
    {open?<ReclaudeAuthorizationDialog orgId="1" onClose={()=>setOpen(false)} onAuthenticated={()=>setCompleted(true)}/>:null}</>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
