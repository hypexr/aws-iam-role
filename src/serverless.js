const { equals, mergeDeepRight } = require('ramda')
const aws = require('aws-sdk')
const {
  createRole,
  deleteRole,
  getRole,
  addRolePolicy,
  removeRolePolicy,
  updateAssumeRolePolicy,
  inputsChanged
} = require('./utils')
const { Component } = require('@serverless/core')

const defaults = {
  service: 'lambda.amazonaws.com',
  policy: {
    arn: null
  },
  region: 'us-east-1'
}

class AwsIamRole extends Component {
  async deploy(inputs = {}) {
    inputs = mergeDeepRight(defaults, inputs)
    const iam = new aws.IAM({ region: inputs.region, credentials: this.credentials.aws })

    await this.status(`Deploying`)

    inputs.name = this.state.name || inputs.name || Math.random().toString(36).substring(6)

    await this.debug(`Syncing role ${inputs.name} in region ${inputs.region}.`)
    const prevRole = await getRole({ iam, ...inputs })

    // If an inline policy, remove ARN
    if (inputs.policy.Version && inputs.policy.Statement) {
      if (inputs.policy.arn) {
        delete inputs.policy.arn
      }
    }

    if (!prevRole) {
      await this.debug(`Creating role ${inputs.name}.`)
      await this.status(`Creating`)
      inputs.arn = await createRole({ iam, ...inputs })
      await this.debug(`Done: ${inputs.arn}`)
    } else {
      inputs.arn = prevRole.arn

      if (inputsChanged(prevRole, inputs)) {
        await this.status(`Updating`)
        if (prevRole.service !== inputs.service) {
          await this.debug(`Updating service for role ${inputs.name}.`)
          await updateAssumeRolePolicy({ iam, ...inputs })
        }
        if (!equals(prevRole.policy, inputs.policy)) {
          await this.debug(`Updating policy for role ${inputs.name}.`)
          await removeRolePolicy({ iam, ...inputs })
          await addRolePolicy({ iam, ...inputs })
        }
      }
    }

    // todo we probably don't need this logic now that
    // we auto generate unconfigurable names
    if (this.state.name && this.state.name !== inputs.name) {
      await this.status(`Replacing`)
      await this.debug(`Deleting/Replacing role ${inputs.name}.`)
      await deleteRole({ iam, name: this.state.name, policy: inputs.policy })
    }

    this.state.name = inputs.name
    this.state.arn = inputs.arn
    this.state.service = inputs.service
    this.state.policy = inputs.policy
    this.state.region = inputs.region
    await this.save()

    await this.debug(`Saved state for role ${inputs.name}.`)

    const outputs = {
      name: inputs.name,
      arn: inputs.arn,
      service: inputs.service,
      policy: inputs.policy
    }

    await this.debug(`Role ${inputs.name} was successfully deployed to region ${inputs.region}.`)
    await this.debug(`Deployed role arn is ${inputs.arn}.`)

    return outputs
  }

  async remove() {
    await this.status(`Removing`)

    if (!this.state.name) {
      await this.debug(`Aborting removal. Role name not found in state.`)
      return
    }

    const iam = new aws.IAM({
      region: this.state.region,
      credentials: this.credentials.aws
    })

    await this.debug(`Removing role ${this.state.name} from region ${this.state.region}.`)
    await deleteRole({ iam, ...this.state })
    await this.debug(
      `Role ${this.state.name} successfully removed from region ${this.state.region}.`
    )

    const outputs = {
      name: this.state.name,
      arn: this.state.arn,
      service: this.state.service,
      policy: this.state.policy
    }

    this.state = {}
    await this.save()

    return outputs
  }
}

module.exports = AwsIamRole