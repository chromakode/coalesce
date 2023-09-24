import {
  Button,
  Collapse,
  HStack,
  Icon,
  Input,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Switch,
  Text,
  VStack,
  useClipboard,
  useToast,
} from '@chakra-ui/react'
import { Project } from '@shared/types'
import React, { useCallback, useMemo, useRef } from 'react'
import { MdSupervisorAccount } from 'react-icons/md'
import { useAPI } from './APIContext'

export function CollaborateButton({ project }: { project: Project }) {
  const { updateProject } = useAPI()
  const { guestEditKey } = project

  const guestEditURL = useMemo(() => {
    if (!guestEditKey) {
      return ''
    }
    const url = new URL(window.location.toString())
    url.searchParams.set('guestEditKey', guestEditKey)
    return url.toString()
  }, [guestEditKey])

  const toast = useToast()
  const { onCopy } = useClipboard(guestEditURL)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleInputClick = useCallback(() => {
    inputRef.current?.select()
    onCopy()
    toast({
      title: 'Guest editor link copied',
      status: 'success',
      position: 'top',
    })
  }, [onCopy])

  const handleSwitchChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      updateProject(project.projectId, {
        guestEditKey: ev.target.checked ? 'new' : null,
      })
    },
    [project],
  )

  return (
    <Popover>
      <PopoverTrigger>
        <Button
          color={guestEditKey ? 'green.700' : 'black'}
          leftIcon={<Icon fontSize="2xl" as={MdSupervisorAccount} />}
        >
          Collaborate
        </Button>
      </PopoverTrigger>
      <PopoverContent p={2} boxShadow="lg">
        <PopoverArrow />
        <PopoverHeader fontWeight="bold" border="none">
          Invite collaborators
        </PopoverHeader>
        <PopoverBody>
          <VStack alignItems="stretch">
            <HStack w="full">
              <Text flex="1">Guest editor link</Text>
              <Switch
                isChecked={Boolean(guestEditKey)}
                onChange={handleSwitchChange}
              />
            </HStack>
            <Collapse in={!!guestEditURL}>
              <Input
                ref={inputRef}
                disabled={!guestEditURL}
                value={guestEditURL}
                onClick={handleInputClick}
                variant="filled"
                p={2}
              />
            </Collapse>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}
