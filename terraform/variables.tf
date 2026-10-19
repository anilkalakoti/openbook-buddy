variable "linode_token" {
  type        = string
  description = "Your Linode APIv4 Token"
  sensitive   = true
}

variable "region" {
  type        = string
  description = "Linode deployment region (e.g., us-east, eu-central)"
  default     = "us-east"
}

variable "instance_type" {
  type        = string
  description = "Linode plan (Note: RAG with local embeddings/Ollama needs at least 4GB-8GB RAM, e.g., g6-standard-2 or g6-standard-4)"
  default     = "g6-standard-2"
}

variable "root_password" {
  type        = string
  description = "Root password for the Linode instance"
  sensitive   = true
}

variable "openai_api_key" {
  type        = string
  description = "Your OpenAI API Key for the backend container"
  sensitive   = true
}