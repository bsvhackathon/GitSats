import { LookupService, LookupQuestion, LookupAnswer, LookupFormula } from '@bsv/overlay'
import { BountyStorage } from './BountyStorage.js'
import { Script, Utils, Transaction, PushDrop } from '@bsv/sdk'
import { Db } from 'mongodb'
import { BountyRecord, BountyReference, RepoIssueReference } from '../types/bounty.js'

/**
 * Implements a lookup service for GitHub issue bounties
 */
class BountyLookupService implements LookupService {
  /**
   * Constructs a new BountyLookupService instance
   * @param storage - The storage instance to use for managing bounty records
   */
  constructor(public storage: BountyStorage) { }

  /**
   * Processes a new output that has been added to the blockchain
   */
  async outputAdded(txid: string, outputIndex: number, outputScript: Script, topic: string): Promise<void> {
    if (topic !== 'tm_bounty') return
    
    try {
      // Decode the pushdrop script to extract bounty details
      const decodedScript = PushDrop.decode(outputScript)

      
      const fields = decodedScript.fields
      
      // Extract bounty data from pushdrop fields
      const repoOwner = fields[0]?.toString()
      const repoName = fields[1]?.toString()
      const issueNumber = parseInt(fields[2]?.toString(), 10)
      const amount = parseInt(fields[3]?.toString(), 10)
      const funderPublicKey = fields[4]?.toString()
      const issueTitle = fields[5]?.toString() || `Issue #${issueNumber}`
      const description = fields[6]?.toString() || `Bounty for ${repoOwner}/${repoName}#${issueNumber}`
      
      console.log(`Lookup Service: Processing new bounty from ${txid}:${outputIndex}`)
      
      // Store the bounty record
      await this.storage.storeBounty(
        repoOwner,
        repoName,
        issueNumber,
        amount,
        funderPublicKey,
        issueTitle,
        description,
        txid,
        outputIndex,
        'open'
      )
    } catch (error) {
      console.error('Lookup Service: Failed to process bounty output:', error)
    }
  }

  /**
   * Handles outputs that have been spent
   */
  async outputSpent(txid: string, outputIndex: number, topic: string): Promise<void> {
    if (topic !== 'tm_bounty') return
    
    try {
      console.log(`Lookup Service: Bounty spent at ${txid}:${outputIndex}`)
      
      // Determine if this is a claim or a withdrawal
      // For simplicity, we'll just mark it as claimed
      await this.storage.updateBountyStatus(txid, outputIndex, 'claimed')
      
      // In a full implementation, you'd analyze the spending transaction
      // to determine the exact action (claim or withdrawal) and update accordingly
    } catch (error) {
      console.error('Lookup Service: Error processing spent output:', error)
    }
  }

  /**
   * Handles outputs that have been deleted from the blockchain
   */
  async outputDeleted(txid: string, outputIndex: number, topic: string): Promise<void> {
    if (topic !== 'tm_bounty') return
    
    try {
      console.log(`Lookup Service: Bounty deleted at ${txid}:${outputIndex}`)
      await this.storage.deleteBounty(txid, outputIndex)
    } catch (error) {
      console.error('Lookup Service: Error deleting bounty:', error)
    }
  }

  /**
   * Handles queries to the lookup service
   */
  async lookup(question: LookupQuestion): Promise<LookupAnswer | LookupFormula> {
    try {
      const query = question.query
            
      // Validate query presence
      if (!query) {
        throw new Error('A valid query must be provided!')
      }

      // Validate service
      if (question.service !== 'ls_bounty') {
        throw new Error('Lookup service not supported!')
      }

      // Handle specific queries
      if (query === 'findAllBounties') {
        console.log('Lookup Service: Finding all bounties')
        const result = await this.storage.findAllBounties()
        return {
          type: 'freeform',
          result
        }
      }

      if (isRepoQuery(query)) {
        console.log(`Lookup Service: Finding bounties for repo ${query.value.repoOwner}/${query.value.repoName}`)
        const { repoOwner, repoName } = query.value
        const result = await this.storage.findBountiesByRepo(repoOwner, repoName)
        return {
          type: 'freeform',
          result
        }
      }

      if (isIssueQuery(query)) {
        console.log(`Lookup Service: Finding bounties for issue ${query.value.repoOwner}/${query.value.repoName}#${query.value.issueNumber}`)
        const { repoOwner, repoName, issueNumber } = query.value
        const result = await this.storage.findBountiesByIssue(repoOwner, repoName, issueNumber)
        return {
          type: 'freeform',
          result
        }
      }

      if (isFunderQuery(query)) {
        console.log(`Lookup Service: Finding bounties by funder ${query.value.publicKey}`)
        const { publicKey } = query.value
        const result = await this.storage.findBountiesByFunder(publicKey)
        return {
          type: 'freeform',
          result
        }
      }

      if (isBountyDetailsQuery(query)) {
        console.log(`Lookup Service: Retrieving bounty details for ${query.value.txid}:${query.value.outputIndex}`)
        const { txid, outputIndex } = query.value
        const result = await this.storage.findBountyDetails(txid, outputIndex)
        return {
          type: 'freeform',
          result
        }
      }

      if (query === 'findReposWithBounties') {
        console.log('Lookup Service: Finding all repositories with bounties')
        const result = await this.storage.findReposWithBounties()
        return {
          type: 'freeform',
          result
        }
      }
      
      throw new Error(`Unknown query type: ${JSON.stringify(query)}`)
    } catch (error) {
      console.error('Lookup Service: Failed to process lookup query:', error)
      throw error
    }
  }

  /**
   * Returns documentation for this lookup service
   */
  async getDocumentation(): Promise<string> {
    return `
    # GitHub Bounty Lookup Service
    
    This service allows querying information about GitHub issue bounties.
    
    ## Available Queries
    
    1. \`findAllBounties\` - List all available bounties
    2. \`findByRepo\` - Find bounties for a specific repository
    3. \`findByIssue\` - Find bounties for a specific issue
    4. \`findByFunder\` - Find bounties funded by a specific user
    5. \`findBountyDetails\` - Get detailed information about a specific bounty
    6. \`findReposWithBounties\` - List all repositories with bounties
    
    ## Example Queries
    
    ### Find bounties for a repository
    
    \`\`\`
    {
      "type": "findByRepo",
      "value": {
        "repoOwner": "bitcoin-sv",
        "repoName": "bsv-overlay"
      }
    }
    \`\`\`
    
    ### Find bounties for a specific issue
    
    \`\`\`
    {
      "type": "findByIssue",
      "value": {
        "repoOwner": "bitcoin-sv",
        "repoName": "bsv-overlay",
        "issueNumber": 42
      }
    }
    \`\`\`
    `
  }

  /**
   * Returns metadata about this lookup service
   */
  async getMetaData(): Promise<{
    name: string
    shortDescription: string
    iconURL?: string
    version?: string
    informationURL?: string
  }> {
    return {
      name: 'GitHub Bounty Lookup Service',
      shortDescription: 'Find and manage GitHub issue bounties',
      version: '1.0.0',
      informationURL: 'https://github.com/yourusername/github-bounties'
    }
  }
}

// Type guards for query types
function isRepoQuery(query: any): query is { type: 'findByRepo'; value: { repoOwner: string, repoName: string } } {
  return (
    typeof query === 'object' &&
    query.type === 'findByRepo' &&
    query.value &&
    typeof query.value.repoOwner === 'string' &&
    typeof query.value.repoName === 'string'
  )
}

function isIssueQuery(query: any): query is { type: 'findByIssue'; value: { repoOwner: string, repoName: string, issueNumber: number } } {
  return (
    typeof query === 'object' &&
    query.type === 'findByIssue' &&
    query.value &&
    typeof query.value.repoOwner === 'string' &&
    typeof query.value.repoName === 'string' &&
    typeof query.value.issueNumber === 'number'
  )
}

function isFunderQuery(query: any): query is { type: 'findByFunder'; value: { publicKey: string } } {
  return (
    typeof query === 'object' &&
    query.type === 'findByFunder' &&
    query.value &&
    typeof query.value.publicKey === 'string'
  )
}

function isBountyDetailsQuery(query: any): query is { type: 'findBountyDetails'; value: { txid: string, outputIndex: number } } {
  return (
    typeof query === 'object' &&
    query.type === 'findBountyDetails' &&
    query.value &&
    typeof query.value.txid === 'string' &&
    typeof query.value.outputIndex === 'number'
  )
}

// Factory function - this is the entry point used by the overlay system
export default (db: Db): BountyLookupService => {
  return new BountyLookupService(new BountyStorage(db))
}