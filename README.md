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
