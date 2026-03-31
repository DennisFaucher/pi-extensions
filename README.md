# pi-extensions
<img width="752" height="398" alt="image" src="https://github.com/user-attachments/assets/3c6223cd-aea3-4f1c-9e62-c08d19de55a6" />

I just started using [pi.dev](https://pi.dev/) as an alternative to OpenClaw.

I have been getting help from Claude in writing the extensions for pi that will make my life easier


### Running Everything Offline
#### Run a local model
`nohup llama-server -hf armand0e/Qwen3-27B-MiniMax-Coder-GGUF:Q4_K_M --alias MiniMax27B &`
#### Define that model to pi
`vi ~/.pi/agent/models.json`
```
{
  "providers": {
    "llama-cpp": {
      "baseUrl": "http://localhost:8080/v1",
      "api": "openai-completions",
      "apiKey": "none",
      "models": [
        {
          "id": "MiniMax27B"
        }
      ]
    }
  }
}
```
#### Start pi
```
 pi

 pi v0.64.0                                                                                                                          
 escape to interrupt                                                                                                                 
 ctrl+c to clear                                                                                                                     
 ctrl+c twice to exit                                                                                                                
 ctrl+d to exit (empty)                                                                                                              
 ctrl+z to suspend                                                                                                                   
 ctrl+k to delete to end                                                                                                             
 shift+tab to cycle thinking level                                                                                                   
 ctrl+p/shift+ctrl+p to cycle models                                                                                                 
 ctrl+l to select model                                                                                                              
 ctrl+o to expand tools                                                                                                              
 ctrl+t to expand thinking                                                                                                           
 ctrl+g for external editor                                                                                                          
 / for commands                                                                                                                      
 ! to run bash                                                                                                                       
 !! to run bash (no context)                                                                                                         
 alt+enter to queue follow-up                                                                                                        
 alt+up to edit all queued messages                                                                                                  
 ctrl+v to paste image                                                                                                               
 drop files to attach                                                                                                                
                                                                                                                                     
 Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.                                               

[Extensions]                                                                                                                         
  user                                                                                                                               
    ~/.pi/agent/extensions/accuweather.ts                                                                                            
    ~/.pi/agent/extensions/logseq.ts                                                                                                 
    ~/.pi/agent/extensions/searxng.ts                                                                                                
    npm:pi-extension-manager                                                                                                         
      index.ts                                                                                                                       


───────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                                                                     
───────────────────────────────────────────────────────────────────────────────────────────────────────────
~/Downloads
0.0%/128k (auto)                                                                 (llama-cpp) MiniMax27B
1 pkg · auto-update off

```

(Notice that llama-cpp is being used at the server and "MiniMax27B" as the model)
