output "instance_ip" {
  value       = linode_instance.openbook_buddy.ip_address
  description = "Public IPv4 address of your OpenBook Buddy server"
}

output "ui_url" {
  value       = "http://${linode_instance.openbook_buddy.ip_address}:3000"
  description = "Public URL to access OpenBook Buddy UI"
}