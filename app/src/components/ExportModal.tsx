import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  Text,
} from '@chakra-ui/react'

export function ExportModal({
  isExporting,
  progress,
  onExport,
  onClose,
}: {
  isExporting: boolean
  progress: number
  onExport: () => void
  onClose: () => void
}) {
  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      closeOnOverlayClick={!isExporting}
      closeOnEsc={!isExporting}
      isCentered
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Export Audio</ModalHeader>
        {!isExporting && <ModalCloseButton />}
        <ModalBody>
          <Text>Mix down and export all audio to a .wav file?</Text>
          <Progress mt="4" value={progress} />
        </ModalBody>
        <ModalFooter>
          {!isExporting && (
            <Button variant="ghost" mr={3} onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button
            colorScheme="green"
            onClick={onExport}
            isLoading={isExporting}
          >
            Export to .wav
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
