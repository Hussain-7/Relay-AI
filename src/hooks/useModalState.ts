import { useState } from "react";

export function useModalState() {
  const [connectorModalOpen, setConnectorModalOpen] = useState(false);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [repoChipOpen, setRepoChipOpen] = useState(false);
  const [secretsModalOpen, setSecretsModalOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [renamingConversation, setRenamingConversation] = useState<{ id: string; title: string } | null>(null);

  return {
    connectorModalOpen,
    setConnectorModalOpen,
    repoModalOpen,
    setRepoModalOpen,
    repoChipOpen,
    setRepoChipOpen,
    secretsModalOpen,
    setSecretsModalOpen,
    searchModalOpen,
    setSearchModalOpen,
    plusMenuOpen,
    setPlusMenuOpen,
    renamingConversation,
    setRenamingConversation,
  };
}
