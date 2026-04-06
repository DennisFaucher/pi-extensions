# pi-extensions
<img width="752" height="398" alt="image" src="https://github.com/user-attachments/assets/3c6223cd-aea3-4f1c-9e62-c08d19de55a6" />

I just started using [pi.dev](https://pi.dev/) as an alternative to OpenClaw.

I have been getting help from Claude in writing the extensions for pi that will make my life easier.
These extensions should be saved to ~/.pi/agent/extensions/

### To Install the Gmail Extension
Copy the gmail folder to ~/.pi/agent/extensions/

Run npm install in that folder to pull down imapflow

Start pi or run /reload in pi

Use /gmail-auth in pi.dev to authenticate

### Using the bejamas-ascii ASCII Art Extension
#### bejamas-ascii

A [pi.dev](https://pi.dev) agent extension that generates ASCII art from a text prompt using the [Bejamas AI ASCII Art Generator](https://bejamas.com/tools/ai-ascii-art-generator).

##### Requirements

- **pi.dev agent** with extension support
- **Claude in Chrome** browser extension — the extension makes HTTP requests to `bejamas.com` from within the browser context, which requires the Claude in Chrome extension to be installed and active. No API key is needed.

##### Installation

Copy `bejamas-ascii.ts` into your pi extensions directory:

```
~/.pi/agent/extensions/bejamas-ascii.ts
```

Restart pi. The `bejamas_ascii_art` tool will be available immediately.

##### Usage

Ask pi to generate ASCII art in natural language:

```
Generate ASCII art of a cat
Generate ASCII art of a spaceship in braille style
Make me some ASCII art of a mountain, classic style
```

###### Parameters

| Parameter | Required | Default    | Description |
|-----------|----------|------------|-------------|
| `prompt`  | yes      | —          | Description of what to generate |
| `style`   | no       | `alphabet` | Rendering style (see below) |

###### Available Styles

| Style       | Description |
|-------------|-------------|
| `classic`   | Dense block characters |
| `dots`      | Dot-matrix rendering |
| `blocks`    | Block element characters |
| `geometric` | Geometric shapes |
| `simple`    | Minimal character set |
| `box`       | Box-drawing characters |
| `horizontal`| Horizontal line emphasis |
| `vertical`  | Vertical line emphasis |
| `braille`   | Braille unicode characters |
| `boxDrawing`| Extended box-drawing characters |
| `alphabet`  | Standard printable ASCII characters |

##### How It Works

The extension POSTs to `https://bejamas.com/api/create-ascii.data` with a form-encoded body containing the prompt and style. The response uses Remix's turbo-stream serialization format, which the extension parses to extract the generated art. All 11 style variants are returned in a single request; the extension surfaces the requested style and stores the rest in `details.allResults` for reference.

No API key or account is required.

##### Notes

- The Bejamas API is a third-party service. Availability and response format may change without notice.
- The output is best viewed in a monospace font. The pi TUI renders tool output in a fixed-width font by default.
- Generation typically takes 5–15 seconds depending on prompt complexity.


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
    ~/.pi/agent/extensions/pirateweather.ts                                                                                            
    ~/.pi/agent/extensions/logseq.ts                                                                                                 
    ~/.pi/agent/extensions/searxng.ts                                                                                                
    npm:pi-extension-manager                                                                                                         
      index.ts                                                                                                                       


───────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                                                                     
───────────────────────────────────────────────────────────────────────────────────────────────────────────
~/Downloads
0.0%/128k (auto)                              (llama-cpp) MiniMax27B
1 pkg · auto-update off

```

(Notice that llama-cpp is being used at the server and "MiniMax27B" as the model)

### pi Prompt
```
 What is the weather in Boston, MA right now                                                                                         
                                                                                                                                     

 The user is asking for the current weather in Boston, MA. I should use the weather_forecast function with the location "Boston, MA" 
 and type "current" to get the current weather conditions.                                                                           

                                                                                                                                     
 weather_forecast                                                                                                                    
 Current conditions in Boston, Suffolk County, Massachusetts, United States:                                                         
   Overcast                                                                                                                          
   Temperature: 41°F (feels like 35°F)                                                                                               
   Humidity: 91%                                                                                                                     
   Wind: 8 mph NE, gusts 14 mph                                                                                                      
   Cloud cover: 92%                                                                                                                  
   UV Index: 0.11                                                                                                                    
   Visibility: 10 km                                                                                                                 
                                                                                                                                     

 I got the current weather conditions for Boston, MA. Let me provide a clear summary to the user.                                    

 Current weather in Boston, MA:                                                                                                      
                                                                                                                                     
 - Conditions: Overcast                                                                                                              
 - Temperature: 41°F (feels like 35°F)                                                                                               
 - Humidity: 91%                                                                                                                     
 - Wind: 8 mph from the northeast, with gusts up to 14 mph                                                                           
 - Cloud cover: 92%                                                                                                                  
 - Visibility: 10 km                                                                                                                 
 - UV Index: 0.11 (very low)                                                                                                         
                                                                                                                                     
 It's a cold and damp day with overcast skies and high humidity.
```

### llama-server Output
```
slot update_slots: id  3 | task 92 | new prompt, n_ctx_slot = 262144, n_keep = 0, task.n_tokens = 3158
slot update_slots: id  3 | task 92 | n_past = 3046, slot.prompt.tokens.size() = 3059, seq_id = 3, pos_min = 3058, n_swa = 0
slot update_slots: id  3 | task 92 | Checking checkpoint with [2967, 2967] against 3046...
slot update_slots: id  3 | task 92 | restored context checkpoint (pos_min = 2967, pos_max = 2967, n_tokens = 2968, n_past = 2968, size = 149.626 MiB)
slot update_slots: id  3 | task 92 | n_tokens = 2968, memory_seq_rm [2968, end)
slot update_slots: id  3 | task 92 | prompt processing progress, n_tokens = 3154, batch.n_tokens = 186, progress = 0.998733
slot update_slots: id  3 | task 92 | n_tokens = 3154, memory_seq_rm [3154, end)
reasoning-budget: activated, budget=2147483647 tokens
reasoning-budget: deactivated (natural end)
slot init_sampler: id  3 | task 92 | init sampler, took 0.26 ms, tokens: text = 3158, total = 3158
slot update_slots: id  3 | task 92 | prompt processing done, n_tokens = 3158, batch.n_tokens = 4
slot update_slots: id  3 | task 92 | created context checkpoint 3 of 32 (pos_min = 3153, pos_max = 3153, n_tokens = 3154, size = 149.626 MiB)
srv  log_server_r: done request: POST /v1/chat/completions 127.0.0.1 200
slot print_timing: id  3 | task 92 | 
prompt eval time =    1922.47 ms /   190 tokens (   10.12 ms per token,    98.83 tokens per second)
       eval time =   11567.97 ms /   138 tokens (   83.83 ms per token,    11.93 tokens per second)
      total time =   13490.45 ms /   328 tokens
slot      release: id  3 | task 92 | stop processing: n_tokens = 3295, truncated = 0
srv  update_slots: all slots are idle
```
