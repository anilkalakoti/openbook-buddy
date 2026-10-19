terraform {
  required_version = ">= 1.0.0"
  required_providers {
    linode = {
      source  = "linode/linode"
      version = "~> 2.0"
    }
  }
}

provider "linode" {
  token = var.linode_token
}

locals {
  # Cloud-init script that runs on first boot of the Linode instance
  user_data = <<-EOT
    #cloud-config
    package_update: true
    package_upgrade: true
    packages:
      - curl
      - git
      - ufw

    runcmd:
      # 1. Install Docker & Docker Compose plugin
      - apt-get remove -y docker docker-engine docker.io containerd runc || true
      - apt-get update
      - apt-get install -y ca-certificates curl gnupg
      - install -m 0755 -d /etc/apt/keyrings
      - curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      - chmod a+r /etc/apt/keyrings/docker.gpg
      - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
      - apt-get update
      - apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

      # 2. Configure Firewall (UFW) to allow SSH (22), Frontend (3000), and Backend (5000)
      - ufw allow 22/tcp
      - ufw allow 3000/tcp
      - ufw allow 5000/tcp
      - ufw --force enable

      # 3. Create app workspace directory
      - mkdir -p /opt/openbook-buddy/backend /opt/openbook-buddy/frontend

      # 4. Write out .env file
      - echo "OPENAI_API_KEY=${var.openai_api_key}" > /opt/openbook-buddy/.env
      - echo "PORT=5000" >> /opt/openbook-buddy/.env
      - echo "OLLAMA_BASE_URL=http://ollama-service:11434" >> /opt/openbook-buddy/.env
      - echo "EMBEDDING_MODEL=qwen3-embedding:0.6b" >> /opt/openbook-buddy/.env
      - echo "CHAT_MODEL=qwen2.5:3b" >> /opt/openbook-buddy/.env
      - echo "CHROMA_HOST=chromadb" >> /opt/openbook-buddy/.env
      - echo "CHROMA_PORT=8000" >> /opt/openbook-buddy/.env

      # 5. Write out docker-compose.yml
      - |
        cat << 'EOF' > /opt/openbook-buddy/docker-compose.yml
        version: '3.8'
        services:
          ollama:
            image: ollama/ollama:latest
            container_name: ollama-service
            ports:
              - "11434:11434"
            volumes:
              - ollama_data:/root/.ollama
            entrypoint: ["/bin/sh", "-c", "ollama serve & sleep 3 && ollama pull qwen3-embedding:0.6b && ollama pull qwen2.5:3b && wait"]
            networks:
              - rag-net
            restart: unless-stopped

          chromadb:
            image: chromadb/chroma:latest
            container_name: chromadb
            ports:
              - "8001:8000"
            volumes:
              - chroma_data:/chroma/chroma
            environment:
              - IS_PERSISTENT=TRUE
            networks:
              - rag-net

          backend:
            build: ./backend
            container_name: backend-service
            ports:
              - "5000:5000"
            environment:
              - PORT=5000
              - OPENAI_API_KEY=$${OPENAI_API_KEY}
              - OLLAMA_BASE_URL=http://ollama-service:11434
              - EMBEDDING_MODEL=qwen3-embedding:0.6b
              - CHAT_MODEL=qwen2.5:3b
              - CHROMA_HOST=chromadb
              - CHROMA_PORT=8000
            depends_on:
              - ollama
              - chromadb
            networks:
              - rag-net

          frontend:
            build: ./frontend
            container_name: frontend-service
            ports:
              - "3000:80"
            depends_on:
              - backend
            networks:
              - rag-net

        volumes:
          ollama_data:
          chroma_data:

        networks:
          rag-net:
            driver: bridge
        EOF

      # Note: You can copy your local project source code (/backend and /frontend) via git clone or SCP here.
      # For demonstration, the system sets up the folder framework ready for your files.
  EOT
}

resource "linode_instance" "openbook_buddy" {
  label           = "openbook-buddy-server"
  image           = "linode/ubuntu22.04"
  region          = var.region
  type            = var.instance_type
  root_pass       = var.root_password
  private_ip      = true
  metadata {
    user_data = base64encode(local.user_data)
  }
}