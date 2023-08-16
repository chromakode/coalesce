import { Box, HStack, Icon, SliderMark, Text, Tooltip } from '@chakra-ui/react'
import { MdPause, MdPlayArrow } from 'react-icons/md'
import { CollaboratorState } from 'src/pages/ProjectPage'

export default function CollaboratorPosition({
  collaboratorState: { name, color, playbackTime, playbackStatus },
}: {
  collaboratorState: CollaboratorState
}) {
  return (
    <Tooltip
      isOpen
      hasArrow
      aria-hidden
      bgColor={color}
      label={
        <HStack spacing={1}>
          <Icon
            fontSize="md"
            // Compensate for a lil extra padding from the icon
            ml="-.1rem"
            as={playbackStatus === 'playing' ? MdPlayArrow : MdPause}
          />
          <Text>{name}</Text>
        </HStack>
      }
      fontSize="xs"
      arrowSize={8}
      offset={[0, 14]}
    >
      <SliderMark value={playbackTime} ml="-.25rem">
        <Box w={2} h={2} mt={-1} borderRadius="full" bgColor={color}></Box>
      </SliderMark>
    </Tooltip>
  )
}
