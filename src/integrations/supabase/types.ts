export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          created_at: string
          email: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          type: Database["public"]["Enums"]["activity_type"]
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          type: Database["public"]["Enums"]["activity_type"]
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          type?: Database["public"]["Enums"]["activity_type"]
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      document_audit: {
        Row: {
          action: string
          created_at: string
          document_id: string | null
          document_version_id: string | null
          gateway_id: string | null
          id: string
          metadata: Json
          project_id: string | null
          request_id: string | null
          result: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          document_id?: string | null
          document_version_id?: string | null
          gateway_id?: string | null
          id?: string
          metadata?: Json
          project_id?: string | null
          request_id?: string | null
          result?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          document_id?: string | null
          document_version_id?: string | null
          gateway_id?: string | null
          id?: string
          metadata?: Json
          project_id?: string | null
          request_id?: string | null
          result?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_audit_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_audit_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_audit_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          checksum_sha256: string | null
          created_at: string
          document_id: string
          gateway_id: string | null
          id: string
          mime_type: string | null
          physical_name: string
          size: number
          storage_error: string | null
          storage_status: Database["public"]["Enums"]["storage_status"]
          stored_at: string | null
          synology_relative_path: string | null
          transit_storage_key: string | null
          updated_at: string
          uploaded_by: string | null
          version_number: number
        }
        Insert: {
          checksum_sha256?: string | null
          created_at?: string
          document_id: string
          gateway_id?: string | null
          id?: string
          mime_type?: string | null
          physical_name: string
          size?: number
          storage_error?: string | null
          storage_status?: Database["public"]["Enums"]["storage_status"]
          stored_at?: string | null
          synology_relative_path?: string | null
          transit_storage_key?: string | null
          updated_at?: string
          uploaded_by?: string | null
          version_number: number
        }
        Update: {
          checksum_sha256?: string | null
          created_at?: string
          document_id?: string
          gateway_id?: string | null
          id?: string
          mime_type?: string | null
          physical_name?: string
          size?: number
          storage_error?: string | null
          storage_status?: Database["public"]["Enums"]["storage_status"]
          stored_at?: string | null
          synology_relative_path?: string | null
          transit_storage_key?: string | null
          updated_at?: string
          uploaded_by?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: Database["public"]["Enums"]["document_category"]
          created_at: string
          created_by: string | null
          current_version_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          folder_id: string | null
          id: string
          mime_type: string | null
          name: string
          owner_id: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["document_status"]
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["document_category"]
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name: string
          owner_id?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["document_category"]
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          owner_id?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      file_jobs: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          document_id: string | null
          document_version_id: string | null
          error: string | null
          gateway_id: string | null
          id: string
          max_attempts: number
          next_retry_at: string | null
          payload: Json
          project_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["file_job_status"]
          transit_storage_key: string | null
          type: Database["public"]["Enums"]["file_job_type"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          document_version_id?: string | null
          error?: string | null
          gateway_id?: string | null
          id?: string
          max_attempts?: number
          next_retry_at?: string | null
          payload?: Json
          project_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["file_job_status"]
          transit_storage_key?: string | null
          type: Database["public"]["Enums"]["file_job_type"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          document_version_id?: string | null
          error?: string | null
          gateway_id?: string | null
          id?: string
          max_attempts?: number
          next_retry_at?: string | null
          payload?: Json
          project_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["file_job_status"]
          transit_storage_key?: string | null
          type?: Database["public"]["Enums"]["file_job_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_jobs_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          allowed_roles: Database["public"]["Enums"]["app_role"][] | null
          created_at: string
          folder_id: string | null
          id: string
          mime_type: string | null
          name: string
          project_id: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          allowed_roles?: Database["public"]["Enums"]["app_role"][] | null
          created_at?: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name: string
          project_id?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          allowed_roles?: Database["public"]["Enums"]["app_role"][] | null
          created_at?: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          project_id?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          allowed_roles: Database["public"]["Enums"]["app_role"][] | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          project_id: string | null
          updated_at: string
        }
        Insert: {
          allowed_roles?: Database["public"]["Enums"]["app_role"][] | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed_roles?: Database["public"]["Enums"]["app_role"][] | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_alert_settings: {
        Row: {
          email_enabled: boolean
          email_recipients: string[]
          id: boolean
          notify_frequency_minutes: number
          offline_threshold_minutes: number
          updated_at: string
        }
        Insert: {
          email_enabled?: boolean
          email_recipients?: string[]
          id?: boolean
          notify_frequency_minutes?: number
          offline_threshold_minutes?: number
          updated_at?: string
        }
        Update: {
          email_enabled?: boolean
          email_recipients?: string[]
          id?: boolean
          notify_frequency_minutes?: number
          offline_threshold_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      gateway_alert_state: {
        Row: {
          connector_id: string
          is_offline: boolean
          last_checked_at: string
          last_notified_at: string | null
        }
        Insert: {
          connector_id: string
          is_offline?: boolean
          last_checked_at?: string
          last_notified_at?: string | null
        }
        Update: {
          connector_id?: string
          is_offline?: boolean
          last_checked_at?: string
          last_notified_at?: string | null
        }
        Relationships: []
      }
      gateway_heartbeats: {
        Row: {
          available_bytes: number | null
          connector_id: string
          failed_jobs: number
          gateway_version: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          nas_host: string | null
          nas_reachable: boolean
          pending_jobs: number
          read_allowed: boolean
          share_accessible: boolean
          smb_connected: boolean
          total_bytes: number | null
          updated_at: string
          used_bytes: number | null
          write_allowed: boolean
        }
        Insert: {
          available_bytes?: number | null
          connector_id: string
          failed_jobs?: number
          gateway_version?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          nas_host?: string | null
          nas_reachable?: boolean
          pending_jobs?: number
          read_allowed?: boolean
          share_accessible?: boolean
          smb_connected?: boolean
          total_bytes?: number | null
          updated_at?: string
          used_bytes?: number | null
          write_allowed?: boolean
        }
        Update: {
          available_bytes?: number | null
          connector_id?: string
          failed_jobs?: number
          gateway_version?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          nas_host?: string | null
          nas_reachable?: boolean
          pending_jobs?: number
          read_allowed?: boolean
          share_accessible?: boolean
          smb_connected?: boolean
          total_bytes?: number | null
          updated_at?: string
          used_bytes?: number | null
          write_allowed?: boolean
        }
        Relationships: []
      }
      gateway_request_nonces: {
        Row: {
          gateway_id: string
          nonce: string
          received_at: string
        }
        Insert: {
          gateway_id: string
          nonce: string
          received_at?: string
        }
        Update: {
          gateway_id?: string
          nonce?: string
          received_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          message: string | null
          read: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string | null
          read?: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string | null
          read?: boolean
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          created_by: string | null
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          last_sign_in_at: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          last_sign_in_at?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          last_sign_in_at?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget: number | null
          client_id: string | null
          client_name: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          manager_id: string | null
          name: string
          progress: number
          project_number: string
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          budget?: number | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          manager_id?: string | null
          name: string
          progress?: number
          project_number: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          budget?: number | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          manager_id?: string | null
          name?: string
          progress?: number
          project_number?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          connector_id: string
          created_at: string
          destination_path: string | null
          file_id: string | null
          id: string
          last_error: string | null
          operation: Database["public"]["Enums"]["sync_job_operation"]
          payload: Json
          project_id: string | null
          result: Json | null
          source_path: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["sync_job_status"]
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          connector_id: string
          created_at?: string
          destination_path?: string | null
          file_id?: string | null
          id?: string
          last_error?: string | null
          operation: Database["public"]["Enums"]["sync_job_operation"]
          payload?: Json
          project_id?: string | null
          result?: Json | null
          source_path?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_job_status"]
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          connector_id?: string
          created_at?: string
          destination_path?: string | null
          file_id?: string | null
          id?: string
          last_error?: string | null
          operation?: Database["public"]["Enums"]["sync_job_operation"]
          payload?: Json
          project_id?: string | null
          result?: Json | null
          source_path?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_job_status"]
        }
        Relationships: []
      }
      synology_configs: {
        Row: {
          created_at: string
          host: string
          id: string
          port: number
          project_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          host: string
          id?: string
          port?: number
          project_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          host?: string
          id?: string
          port?: number
          project_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "synology_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_count: { Args: never; Returns: number }
      can_access_folder: {
        Args: { _folder_id: string; _user_id: string }
        Returns: boolean
      }
      check_gateway_offline_alerts: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      notify_project_members: {
        Args: {
          _exclude: string
          _link: string
          _message: string
          _project_id: string
          _title: string
          _type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: undefined
      }
      project_storage_prefix: { Args: { _project_id: string }; Returns: string }
      user_has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      activity_type:
        | "sign_in"
        | "sign_out"
        | "sign_in_failed"
        | "password_reset"
        | "account_disabled"
        | "account_enabled"
      app_role: "admin" | "chef_projet" | "ingenieur" | "client"
      audit_action: "insert" | "update" | "delete"
      document_category:
        | "ADMINISTRATIF"
        | "CONTRATS"
        | "DEVIS"
        | "FACTURES"
        | "PLANS"
        | "RAPPORTS"
        | "PHOTOS"
        | "PV"
        | "AUTRES"
      document_status: "ACTIVE" | "ARCHIVED" | "SOFT_DELETED"
      file_job_status:
        | "PENDING"
        | "CLAIMED"
        | "RUNNING"
        | "COMPLETED"
        | "FAILED"
        | "RETRY"
      file_job_type:
        | "UPLOAD_FILE"
        | "READ_FILE"
        | "CREATE_DIRECTORY"
        | "MOVE_FILE"
        | "RENAME_FILE"
        | "ARCHIVE_FILE"
        | "DELETE_FILE"
        | "HEALTH_CHECK"
        | "CALCULATE_CHECKSUM"
      notification_type: "document" | "tache" | "projet" | "rapport" | "systeme"
      project_status: "en_preparation" | "en_cours" | "suspendu" | "termine"
      storage_status:
        | "PENDING_STORAGE"
        | "UPLOADING"
        | "STORED"
        | "STORAGE_FAILED"
        | "ARCHIVED"
        | "UNAVAILABLE"
      sync_job_operation:
        | "CREATE_FOLDER"
        | "CREATE_PROJECT_STRUCTURE"
        | "UPLOAD_FILE"
        | "DOWNLOAD_FILE"
        | "RENAME_FILE"
        | "MOVE_FILE"
        | "DELETE_FILE"
        | "RESTORE_FILE"
        | "CALCULATE_CHECKSUM"
        | "SCAN_FOLDER"
        | "SYNC_METADATA"
        | "GATEWAY_DIAGNOSTIC"
      sync_job_status:
        | "PENDING"
        | "PROCESSING"
        | "COMPLETED"
        | "FAILED"
        | "CONFLICT"
      task_priority: "basse" | "normale" | "haute" | "urgente"
      task_status: "a_faire" | "en_cours" | "termine"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: [
        "sign_in",
        "sign_out",
        "sign_in_failed",
        "password_reset",
        "account_disabled",
        "account_enabled",
      ],
      app_role: ["admin", "chef_projet", "ingenieur", "client"],
      audit_action: ["insert", "update", "delete"],
      document_category: [
        "ADMINISTRATIF",
        "CONTRATS",
        "DEVIS",
        "FACTURES",
        "PLANS",
        "RAPPORTS",
        "PHOTOS",
        "PV",
        "AUTRES",
      ],
      document_status: ["ACTIVE", "ARCHIVED", "SOFT_DELETED"],
      file_job_status: [
        "PENDING",
        "CLAIMED",
        "RUNNING",
        "COMPLETED",
        "FAILED",
        "RETRY",
      ],
      file_job_type: [
        "UPLOAD_FILE",
        "READ_FILE",
        "CREATE_DIRECTORY",
        "MOVE_FILE",
        "RENAME_FILE",
        "ARCHIVE_FILE",
        "DELETE_FILE",
        "HEALTH_CHECK",
        "CALCULATE_CHECKSUM",
      ],
      notification_type: ["document", "tache", "projet", "rapport", "systeme"],
      project_status: ["en_preparation", "en_cours", "suspendu", "termine"],
      storage_status: [
        "PENDING_STORAGE",
        "UPLOADING",
        "STORED",
        "STORAGE_FAILED",
        "ARCHIVED",
        "UNAVAILABLE",
      ],
      sync_job_operation: [
        "CREATE_FOLDER",
        "CREATE_PROJECT_STRUCTURE",
        "UPLOAD_FILE",
        "DOWNLOAD_FILE",
        "RENAME_FILE",
        "MOVE_FILE",
        "DELETE_FILE",
        "RESTORE_FILE",
        "CALCULATE_CHECKSUM",
        "SCAN_FOLDER",
        "SYNC_METADATA",
        "GATEWAY_DIAGNOSTIC",
      ],
      sync_job_status: [
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "CONFLICT",
      ],
      task_priority: ["basse", "normale", "haute", "urgente"],
      task_status: ["a_faire", "en_cours", "termine"],
    },
  },
} as const
